/**
 * CAD simulado, en dos modos:
 *
 * - `contrato`: habla el contrato v1 directo con POL-IAQ (como un CAD que ya lo implementa).
 *   Recibe `incidente.creado` en POST /eventos (firma HMAC) y responde con eventos firmados.
 * - `nativo`: se comporta como un CAD con su propio formato, detrás del adaptador de referencia
 *   (services/cad-adaptador). Recibe POST /incidentes y /incidentes/:folio/actualizaciones y
 *   manda sus eventos y su AVL al adaptador.
 *
 * En los dos acusa, asigna, mueve la unidad, marca en sitio y cierra. En modo `nativo` entiende
 * marcas de prueba en la descripción del reporte (solo para el ambiente de pruebas):
 * `[prueba:reclasificar=30309]`, `[prueba:transferir=cad-queretaro]`, `[prueba:caida=2]`
 * (responde 503 a las 2 primeras entregas) y `[prueba:duplicado]` (manda su acuse dos veces).
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventoHaciaCadSchema, etiquetaCnie, firmar, validarCodigoCnie, verificarFirma } from './tipos';

export interface UnidadSimulada { unidadId: string; corporacion: string; etiqueta: string }

export interface OpcionesSimulador {
  modo: 'contrato' | 'nativo';
  /** Pausa entre pasos de la simulación (ms). */
  pasoMs: number;
  /** contrato: URL de POL-IAQ y secreto de cada CAD. */
  polIaqUrl?: string;
  cads?: Record<string, { secreto: string }>;
  /** nativo: URL del adaptador, cadId de las rutas y tokens. */
  adaptadorUrl?: string;
  cadId?: string;
  tokenHaciaAdaptador?: string;
  tokenEntrada?: string;
  /** Unidades del CAD (nativo); sin ellas inventa claves U-###. */
  unidades?: UnidadSimulada[];
  log?: (linea: string) => void;
}

export interface Simulador {
  servidor: Server;
  /** Se leen en cada envío: se pueden completar después de crear el simulador (p. ej. la URL del adaptador). */
  opciones: OpcionesSimulador;
  /** Folios que el CAD tiene abiertos (solo folio y estado; nada personal). */
  incidentes: Map<string, { estado: string; altas: number }>;
  cerrar(): Promise<void>;
}

const ETIQUETA: Record<string, string> = {
  policia_municipal: 'Patrulla',
  policia_estatal: 'Patrulla estatal',
  cruz_roja: 'Ambulancia',
  bomberos: 'Unidad de bomberos',
  proteccion_civil: 'Protección Civil',
};

const marca = (texto: string | undefined, nombre: string) => new RegExp(`\\[prueba:${nombre}(?:=([^\\]]+))?\\]`).exec(texto ?? '');

export function crearSimulador(o: OpcionesSimulador): Simulador {
  const log = o.log ?? ((l: string) => console.log(l));
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const incidentes = new Map<string, { estado: string; altas: number }>();
  const intentosPorFolio = new Map<string, number>();
  let cerrado = false;

  // ── Modo contrato ─────────────────────────────────────────────────────────
  const cadPorFirma = (ts: number, cuerpo: string, firma: string) => Object.entries(o.cads ?? {}).find(([, c]) => verificarFirma(c.secreto, ts, cuerpo, firma))?.[0];

  async function enviarContrato(cadId: string, folio: string, secuencia: number, tipo: string, datos: Record<string, unknown>) {
    const cuerpo = JSON.stringify({ eventoId: randomUUID(), folio, secuencia, ocurridoEn: new Date().toISOString(), tipo, datos });
    const ts = Math.floor(Date.now() / 1000);
    const resp = await fetch(`${o.polIaqUrl}/v1/cad/${cadId}/eventos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poliaq-timestamp': String(ts), 'x-poliaq-firma': firmar(o.cads![cadId].secreto, ts, cuerpo) },
      body: cuerpo,
    });
    log(`[${cadId}] ${folio} ${tipo} -> ${resp.status}`);
  }

  async function simularContrato(cadId: string, folio: string, lat: number, lng: number, corporacion = 'policia_municipal', codigoCnie?: string | null) {
    let s = 0;
    const unidadId = `U-${Math.floor(100 + Math.random() * 900)}`;
    const registrado = codigoCnie && validarCodigoCnie(codigoCnie).ok ? { codigoCnie } : {};
    await enviarContrato(cadId, folio, ++s, 'incidente.recibido', { folioCad: `${cadId.toUpperCase()}-${Date.now() % 100000}`, operador: 'Operador simulado', ...registrado });
    await espera(o.pasoMs);
    await enviarContrato(cadId, folio, ++s, 'unidad.asignada', { unidadId, corporacion, etiqueta: `${ETIQUETA[corporacion] ?? 'Unidad'} ${unidadId.slice(2)}`, etaMinutos: 6 });
    await enviarContrato(cadId, folio, ++s, 'mensaje.operador', { texto: 'Recibimos tu reporte, una unidad va en camino.', autor: 'Operador simulado' });
    // La unidad arranca ~1.5 km al norte y se acerca en 6 pasos.
    for (let i = 6; i >= 1; i--) {
      await espera(o.pasoMs);
      await enviarContrato(cadId, folio, ++s, 'unidad.posicion', { unidadId, lat: lat + 0.0025 * i, lng: lng + 0.001 * i, etaMinutos: i });
    }
    await espera(o.pasoMs);
    await enviarContrato(cadId, folio, ++s, 'incidente.estado', { estado: 'en_sitio' });
    await espera(o.pasoMs * 2);
    await enviarContrato(cadId, folio, ++s, 'incidente.estado', { estado: 'cerrado', nota: 'Atendido por la unidad (simulación)' });
  }

  function webhookContrato(cuerpo: string, ts: number, firma: string): number {
    const cadId = cadPorFirma(ts, cuerpo, firma);
    if (!cadId) return 401;
    const p = EventoHaciaCadSchema.safeParse(JSON.parse(cuerpo));
    if (!p.success) return 400;
    const ev = p.data;
    log(`[${cadId}] recibido ${ev.tipo} ${ev.folio}`);
    if (ev.tipo === 'incidente.creado') {
      const { canalizacion, cuestionario, cnie, codigoCnie } = ev.datos;
      log(`[${cadId}] ${cnie ? etiquetaCnie(cnie) : 'Sin clasificación CNIE (la asigna el operador)'}${cnie?.secundario ? ` · secundario ${cnie.secundario.codigo}` : ''}`);
      const v = codigoCnie ? validarCodigoCnie(codigoCnie) : null;
      if (v && !v.ok) log(`[${cadId}] ${ev.folio}: ${v.mensaje}`);
      log(`[${cadId}] canalización: ${canalizacion.prioridad} -> ${canalizacion.corporaciones.join(', ')}${canalizacion.alertas.length ? ` (${canalizacion.alertas.join('; ')})` : ''}`);
      if (cuestionario.entradas.length) log(cuestionario.transcripcion);
      void simularContrato(cadId, ev.folio, ev.datos.ubicacion.lat, ev.datos.ubicacion.lng, canalizacion.corporaciones[0], codigoCnie).catch((e) => log(String(e)));
    } else if (ev.datos.cnie !== undefined) {
      log(`[${cadId}] ${ev.folio} clasificación: ${ev.datos.cnie ? etiquetaCnie(ev.datos.cnie) : 'sin código'}`);
    }
    if (ev.tipo === 'incidente.actualizado' && ev.datos.cuestionario) log(`[${cadId}] ${ev.folio} cuestionario actualizado:\n${ev.datos.cuestionario.transcripcion}`);
    return 202;
  }

  // ── Modo nativo (detrás del adaptador) ────────────────────────────────────
  async function nativo(ruta: 'eventos' | 'avl', cuerpo: Record<string, unknown>) {
    if (cerrado) return;
    const resp = await fetch(`${o.adaptadorUrl}/cad/${o.cadId}/${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${o.tokenHaciaAdaptador}` },
      body: JSON.stringify(cuerpo),
    });
    log(`[${o.cadId} nativo] ${ruta === 'avl' ? 'AVL' : String(cuerpo.tipo)} ${String(cuerpo.folio ?? '')} -> ${resp.status}`);
  }

  function unidadPara(corporacion: string): UnidadSimulada {
    const u = o.unidades?.find((x) => x.corporacion === corporacion) ?? o.unidades?.[0];
    if (u) return u;
    const id = `U-${Math.floor(100 + Math.random() * 900)}`;
    return { unidadId: id, corporacion, etiqueta: `${ETIQUETA[corporacion] ?? 'Unidad'} ${id.slice(2)}` };
  }

  async function simularNativo(inc: { folio: string; descripcion?: string; corporacion: string; cnie: { codigo: string | null } | null; ubicacion: { lat: number; lon: number }; enCurso?: { estatus: string; unidad: string | null } }) {
    const { folio } = inc;
    let n = 0;
    const id = () => `${folio}-${++n}`;
    const estado = (e: string) => { const x = incidentes.get(folio); if (x) x.estado = e; };
    const u = inc.enCurso?.unidad ? (o.unidades?.find((x) => x.unidadId === inc.enCurso!.unidad) ?? unidadPara(inc.corporacion)) : unidadPara(inc.corporacion);
    const folioCad = `${String(o.cadId).toUpperCase()}-${Date.now() % 100000}`;
    const acuse = { tipo: 'ACUSE', folio, idEvento: id(), folioCad, operador: 'Operador simulado', ...(inc.cnie?.codigo && validarCodigoCnie(inc.cnie.codigo).ok && { cnie: inc.cnie.codigo }) };
    await nativo('eventos', acuse);
    if (marca(inc.descripcion, 'duplicado')) await nativo('eventos', acuse);
    estado('ACUSADO');
    await espera(o.pasoMs);
    if (!inc.enCurso?.unidad) {
      await nativo('eventos', { tipo: 'ASIGNACION', folio, idEvento: id(), unidad: u.unidadId, corporacion: u.corporacion, descripcionUnidad: u.etiqueta, eta: 6 });
      await nativo('eventos', { tipo: 'MENSAJE', folio, idEvento: id(), texto: 'Recibimos tu reporte, una unidad va en camino.', autor: 'Operador simulado' });
    }
    const recl = marca(inc.descripcion, 'reclasificar');
    if (recl?.[1]) await nativo('eventos', { tipo: 'RECLASIFICACION', folio, idEvento: id(), cnie: recl[1], motivo: 'Corrección del operador del CAD (prueba)', operador: 'Operador simulado' });
    const transf = marca(inc.descripcion, 'transferir');
    if (transf?.[1]) {
      await espera(o.pasoMs);
      await nativo('eventos', { tipo: 'TRANSFERENCIA', folio, idEvento: id(), destino: transf[1], motivo: 'Corresponde a otra jurisdicción (prueba)' });
      estado('TRANSFERIDO');
      return;
    }
    for (let i = 3; i >= 1; i--) {
      await espera(o.pasoMs);
      const pos = { lat: +(inc.ubicacion.lat + 0.002 * i).toFixed(6), lon: +(inc.ubicacion.lon + 0.001 * i).toFixed(6) };
      await nativo('eventos', { tipo: 'GPS', folio, idEvento: id(), unidad: u.unidadId, ...pos, eta: i * 2 });
      if (i === 2) await nativo('avl', { posiciones: [{ unidad: u.unidadId, ...pos, fecha: new Date().toISOString() }] });
    }
    await espera(o.pasoMs);
    await nativo('eventos', { tipo: 'ESTATUS', folio, idEvento: id(), estatus: 'EN_SITIO' });
    await espera(o.pasoMs);
    await nativo('eventos', { tipo: 'ESTATUS', folio, idEvento: id(), estatus: 'CERRADO', nota: 'Atendido por la unidad (simulación)' });
    estado('CERRADO');
  }

  function altaNativa(json: Record<string, unknown>): number {
    const folio = String(json.folio ?? '');
    if (!folio) return 400;
    const caida = marca(json.descripcion as string | undefined, 'caida');
    const intentos = (intentosPorFolio.get(folio) ?? 0) + 1;
    intentosPorFolio.set(folio, intentos);
    if (caida && intentos <= Number(caida[1] ?? 1)) {
      log(`[${o.cadId} nativo] ${folio}: caída simulada (intento ${intentos})`);
      return 503;
    }
    const previo = incidentes.get(folio);
    if (previo && !json.enCurso) {
      // La misma alta otra vez (mismo eventoId reentregado): no se abre un segundo incidente.
      previo.altas++;
      log(`[${o.cadId} nativo] ${folio}: alta repetida, se ignora`);
      return 200;
    }
    incidentes.set(folio, { estado: 'NUEVO', altas: 1 });
    void simularNativo(json as unknown as Parameters<typeof simularNativo>[0]).catch((e) => log(String(e)));
    return 201;
  }

  const servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString('utf8');
      const url = req.url ?? '';
      if (req.method !== 'POST') return void res.writeHead(404).end();
      if (o.modo === 'contrato') {
        if (url !== '/eventos') return void res.writeHead(404).end();
        try {
          return void res.writeHead(webhookContrato(cuerpo, Number(req.headers['x-poliaq-timestamp']), String(req.headers['x-poliaq-firma'] ?? ''))).end();
        } catch {
          return void res.writeHead(400).end();
        }
      }
      if (o.tokenEntrada && req.headers.authorization !== `Bearer ${o.tokenEntrada}`) return void res.writeHead(401).end();
      let json: Record<string, unknown>;
      try { json = JSON.parse(cuerpo); } catch { return void res.writeHead(400).end(); }
      if (url === '/incidentes') return void res.writeHead(altaNativa(json)).end('{}');
      if (/^\/incidentes\/[^/]+\/actualizaciones$/.test(url)) {
        log(`[${o.cadId} nativo] actualización de ${String(json.folio)}: ${Object.keys((json.cambios as object) ?? {}).join(', ')}`);
        return void res.writeHead(200).end('{}');
      }
      res.writeHead(404).end();
    });
  });

  return {
    servidor,
    opciones: o,
    incidentes,
    async cerrar() {
      cerrado = true;
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}
