/**
 * CAD simulado.
 *
 * Recibe `incidente.creado` de Pol-IAQ (firma HMAC verificada) y responde como
 * lo haría un CAD: acusa recibo, asigna una unidad, la mueve hacia el lugar,
 * marca "en sitio" y cierra. Sirve para demos y para probar la app ciudadana.
 *
 * Variables: SIM_PORT (4000), POLIAQ_URL (http://localhost:3000) y CADS_JSON
 * (el mismo JSON que usa el API, para conocer el secreto de cada CAD).
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventoHaciaCadSchema, firmar, verificarFirma, type CadConfigLike } from './tipos';

const PORT = Number(process.env.SIM_PORT ?? 4000);
const POLIAQ_URL = process.env.POLIAQ_URL ?? 'http://localhost:3000';
const CADS = JSON.parse(process.env.CADS_JSON ?? '{}') as Record<string, CadConfigLike>;
const PASO_MS = Number(process.env.SIM_STEP_MS ?? 3000);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Identifica qué CAD es por el secreto con el que firmó Pol-IAQ. */
function cadPorFirma(ts: number, cuerpo: string, firma: string): string | undefined {
  return Object.entries(CADS).find(([, c]) => verificarFirma(c.secreto, ts, cuerpo, firma))?.[0];
}

async function enviar(cadId: string, folio: string, secuencia: number, tipo: string, datos: Record<string, unknown>) {
  const cuerpo = JSON.stringify({ eventoId: randomUUID(), folio, secuencia, ocurridoEn: new Date().toISOString(), tipo, datos });
  const ts = Math.floor(Date.now() / 1000);
  const resp = await fetch(`${POLIAQ_URL}/v1/cad/${cadId}/eventos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-poliaq-timestamp': String(ts), 'x-poliaq-firma': firmar(CADS[cadId].secreto, ts, cuerpo) },
    body: cuerpo,
  });
  console.log(`[${cadId}] ${folio} ${tipo} -> ${resp.status}`);
}

const ETIQUETA: Record<string, string> = {
  policia_municipal: 'Patrulla',
  policia_estatal: 'Patrulla estatal',
  cruz_roja: 'Ambulancia',
  bomberos: 'Unidad de bomberos',
  proteccion_civil: 'Protección Civil',
};

/** Despacha la unidad de la corporación principal que indica la canalización. */
async function simular(cadId: string, folio: string, lat: number, lng: number, corporacion = 'policia_municipal') {
  let s = 0;
  const unidadId = `U-${Math.floor(100 + Math.random() * 900)}`;
  await enviar(cadId, folio, ++s, 'incidente.recibido', { folioCad: `${cadId.toUpperCase()}-${Date.now() % 100000}`, operador: 'Operador simulado' });
  await espera(PASO_MS);
  await enviar(cadId, folio, ++s, 'unidad.asignada', { unidadId, corporacion, etiqueta: `${ETIQUETA[corporacion] ?? 'Unidad'} ${unidadId.slice(2)}`, etaMinutos: 6 });
  await enviar(cadId, folio, ++s, 'mensaje.operador', { texto: 'Recibimos tu reporte, una unidad va en camino.', autor: 'Operador simulado' });
  // La unidad arranca ~1.5 km al norte y se acerca en 6 pasos.
  for (let i = 6; i >= 1; i--) {
    await espera(PASO_MS);
    await enviar(cadId, folio, ++s, 'unidad.posicion', { unidadId, lat: lat + 0.0025 * i, lng: lng + 0.001 * i, etaMinutos: i });
  }
  await espera(PASO_MS);
  await enviar(cadId, folio, ++s, 'incidente.estado', { estado: 'en_sitio' });
  await espera(PASO_MS * 2);
  await enviar(cadId, folio, ++s, 'incidente.estado', { estado: 'cerrado', nota: 'Atendido por la unidad (simulación)' });
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/eventos') {
    res.writeHead(404).end();
    return;
  }
  const partes: Buffer[] = [];
  req.on('data', (c: Buffer) => partes.push(c));
  req.on('end', () => {
    const cuerpo = Buffer.concat(partes).toString('utf8');
    const cadId = cadPorFirma(Number(req.headers['x-poliaq-timestamp']), cuerpo, String(req.headers['x-poliaq-firma'] ?? ''));
    if (!cadId) {
      res.writeHead(401).end();
      return;
    }
    const p = EventoHaciaCadSchema.safeParse(JSON.parse(cuerpo));
    if (!p.success) {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(202).end();
    const ev = p.data;
    console.log(`[${cadId}] recibido ${ev.tipo} ${ev.folio}`);
    if (ev.tipo === 'incidente.creado') {
      const { canalizacion, cuestionario } = ev.datos;
      console.log(`[${cadId}] canalización: ${canalizacion.prioridad} -> ${canalizacion.corporaciones.join(', ')}${canalizacion.alertas.length ? ` (${canalizacion.alertas.join('; ')})` : ''}`);
      if (cuestionario.entradas.length) console.log(cuestionario.transcripcion);
      void simular(cadId, ev.folio, ev.datos.ubicacion.lat, ev.datos.ubicacion.lng, canalizacion.corporaciones[0]).catch((e) => console.error(e));
    } else if (ev.datos.cuestionario) {
      console.log(`[${cadId}] ${ev.folio} cuestionario actualizado:\n${ev.datos.cuestionario.transcripcion}`);
    }
  });
}).listen(PORT, () => console.log(`CAD simulado escuchando en :${PORT}, enviando a ${POLIAQ_URL}`));
