/**
 * Adaptador de referencia (Modo A): traduce entre el contrato v1 de POL-IAQ y el CAD del municipio.
 *
 *   POL-IAQ ──incidente.creado / incidente.actualizado (HMAC)──▶ adaptador ──formato nativo──▶ CAD
 *   POL-IAQ ◀──7 eventos del CAD en /v1/cad/{cadId}/eventos y AVL en lote en /v1/cad/{cadId}/avl── adaptador ◀── CAD
 *
 * Rutas (alojado: con :cadId; instalado: también sin él):
 * - POST /poliaq/:cadId/eventos   webhook que POL-IAQ llama (firma HMAC, idempotency-key)
 * - POST /cad/:cadId/eventos      eventos del CAD en su formato (Authorization: Bearer <tokenDesdeCad>)
 * - POST /cad/:cadId/avl          posiciones GPS en lote del CAD
 * - GET  /salud
 *
 * Qué guarda (solo en memoria, sin datos personales): ids de eventos ya entregados (24 h), la
 * última secuencia por folio y qué unidad atiende qué folio. Los datos del reportante solo pasan.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { EventoDesdeCadSchema, EventoHaciaCadSchema, firmar, verificarFirma, type EventoDesdeCad } from '@pol-iaq/shared';
import type { ConfigAdaptador, Tenant } from './config';
import { AvlNativoSchema, EventoNativoSchema, desdeCad, haciaCad } from './nativo';

const VIGENCIA_IDS_MS = 24 * 60 * 60 * 1000;
const MAX_CUERPO = 2 * 1024 * 1024;
const MAX_LOTE_AVL = 500;

type Registro = (linea: string) => void;

interface Respuesta { status: number; cuerpo: string }

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((ok, mal) => {
    const partes: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > MAX_CUERPO) { mal(new Error('cuerpo_muy_grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', mal);
  });
}

const responder = (res: ServerResponse, status: number, cuerpo: unknown = {}) => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
};

const mismoToken = (a: string, b: string) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** UUID estable a partir del id de evento del CAD: sus reintentos llegan a POL-IAQ con el mismo eventoId. */
export function eventoIdDe(cadId: string, idEvento: string): string {
  const h = createHash('sha256').update(`${cadId}:${idEvento}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export interface Adaptador {
  servidor: Server;
  url(): string;
  cerrar(): Promise<void>;
  /** Copia de lo que tiene en memoria (para revisar que no guarda datos personales). */
  estadoInterno(): { eventosEntregados: string[]; secuencias: Record<string, number>; unidades: Record<string, string>; avlPendiente: number; colaSalida: number };
}

export function crearAdaptador(config: ConfigAdaptador, log: Registro = (l) => console.log(l)): Adaptador {
  const entregados = new Map<string, number>(); // eventoId de POL-IAQ → vence
  const secuencias = new Map<string, number>(); // `${cadId}|${folio}` → última secuencia enviada
  const unidadFolio = new Map<string, string>(); // `${cadId}|${unidadId}` → folio
  const avl = new Map<string, { unidadId: string; lat: number; lng: number; rumbo?: number; en?: string }[]>();
  let enCola = 0;
  let cerrando = false;
  const agente = config.mtls ? new HttpsAgent({ cert: config.mtls.cert, key: config.mtls.key, ca: config.mtls.ca, keepAlive: true }) : undefined;

  /** POST JSON con http/https (https admite certificado de cliente para mTLS). */
  function postJson(url: string, cuerpo: string, cabeceras: Record<string, string>, conMtls: boolean): Promise<Respuesta> {
    return new Promise((ok, mal) => {
      const u = new URL(url);
      const esHttps = u.protocol === 'https:';
      const req = (esHttps ? httpsRequest : httpRequest)(u, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo), ...cabeceras },
        timeout: config.tiempoMaxMs,
        ...(esHttps && conMtls && agente && { agent: agente }),
      }, (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, cuerpo: Buffer.concat(partes).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('tiempo_agotado')));
      req.on('error', mal);
      req.end(cuerpo);
    });
  }

  const espera = (ms: number) => new Promise((r) => { const t = setTimeout(r, ms); t.unref(); });

  /** Firma y entrega a POL-IAQ con reintentos (mismo eventoId: POL-IAQ descarta duplicados). */
  async function aPolIaq(t: Tenant, ruta: string, cuerpoObj: unknown, idempotencia?: string): Promise<Respuesta | null> {
    const cuerpo = JSON.stringify(cuerpoObj);
    enCola++;
    try {
      for (const ms of config.reintentosMs) {
        if (cerrando) return null;
        if (ms) await espera(ms);
        try {
          const ts = Math.floor(Date.now() / 1000);
          const r = await postJson(`${config.polIaqUrl}${ruta}`, cuerpo, {
            'x-poliaq-timestamp': String(ts), 'x-poliaq-firma': firmar(t.secreto, ts, cuerpo), ...(idempotencia && { 'idempotency-key': idempotencia }),
          }, true);
          // 4xx no se reintenta (evento inválido o rechazado); 5xx y red, sí.
          if (r.status < 500) return r;
          log(`[${t.cadId}] POL-IAQ respondió ${r.status} en ${ruta}; se reintenta`);
        } catch (err) {
          log(`[${t.cadId}] sin conexión con POL-IAQ (${(err as Error).message}); se reintenta`);
        }
      }
      log(`[${t.cadId}] no se pudo entregar a POL-IAQ ${ruta} tras ${config.reintentosMs.length} intentos`);
      return null;
    } finally {
      enCola--;
    }
  }

  /** Secuencia creciente por folio que sobrevive reinicios: segundos Unix, o la anterior + 1. */
  function siguienteSecuencia(cadId: string, folio: string) {
    const k = `${cadId}|${folio}`;
    const s = Math.max((secuencias.get(k) ?? 0) + 1, Math.floor(Date.now() / 1000));
    secuencias.set(k, s);
    return s;
  }

  /** Evento del CAD (ya en contrato v1) hacia POL-IAQ. */
  async function enviarEvento(t: Tenant, ev: Omit<EventoDesdeCad, 'eventoId' | 'secuencia' | 'ocurridoEn'>, idEvento?: string) {
    const completo = { ...ev, eventoId: idEvento ? eventoIdDe(t.cadId, idEvento) : randomUUID(), secuencia: siguienteSecuencia(t.cadId, ev.folio), ocurridoEn: new Date().toISOString() } as EventoDesdeCad;
    const p = EventoDesdeCadSchema.safeParse(completo);
    if (!p.success) { log(`[${t.cadId}] evento inválido del CAD (${ev.tipo}); no se envía`); return null; }
    // Qué unidad atiende qué folio (para mandar su GPS como unidad.posicion del folio).
    if (completo.tipo === 'unidad.asignada') unidadFolio.set(`${t.cadId}|${completo.datos.unidadId}`, completo.folio);
    const termina = completo.tipo === 'incidente.transferido' || (completo.tipo === 'incidente.estado' && ['cerrado', 'improcedente'].includes(completo.datos.estado));
    const r = await aPolIaq(t, `/v1/cad/${t.cadId}/eventos`, completo, completo.eventoId);
    if (termina) {
      for (const [k, f] of unidadFolio) if (f === completo.folio && k.startsWith(`${t.cadId}|`)) unidadFolio.delete(k);
      secuencias.delete(`${t.cadId}|${completo.folio}`);
    }
    log(`[${t.cadId}] ${completo.folio} ${completo.tipo} -> ${r?.status ?? 'sin entregar'}`);
    return r;
  }

  async function vaciarAvl() {
    for (const [cadId, posiciones] of avl) {
      if (!posiciones.length) continue;
      const t = config.tenants[cadId];
      const lote = posiciones.splice(0, MAX_LOTE_AVL);
      const r = await aPolIaq(t, `/v1/cad/${cadId}/avl`, { posiciones: lote });
      log(`[${cadId}] AVL ${lote.length} posiciones -> ${r?.status ?? 'sin entregar'}`);
    }
  }
  const relojAvl = setInterval(() => void vaciarAvl().catch((e) => log(`AVL: ${(e as Error).message}`)), config.avlCadaMs);
  relojAvl.unref();

  function tenantDe(cadId: string | undefined): Tenant | undefined {
    if (cadId) return config.tenants[cadId];
    if (config.despliegue === 'instalado') return Object.values(config.tenants)[0];
    return undefined;
  }

  /** POL-IAQ → CAD. Responde 202 solo si el CAD lo aceptó; si no, 502 y POL-IAQ reintenta. */
  async function desdePolIaq(t: Tenant, req: IncomingMessage, res: ServerResponse) {
    const cuerpo = await leerCuerpo(req);
    const ts = Number(req.headers['x-poliaq-timestamp']);
    const firma = String(req.headers['x-poliaq-firma'] ?? '');
    if (!firma || !verificarFirma(t.secreto, ts, cuerpo, firma)) return responder(res, 401, { codigo: 'firma_invalida' });
    let json: unknown;
    try { json = JSON.parse(cuerpo); } catch { return responder(res, 400, { codigo: 'json_invalido' }); }
    const p = EventoHaciaCadSchema.safeParse(json);
    if (!p.success) return responder(res, 400, { codigo: 'evento_invalido' });
    const ev = p.data;
    const ahora = Date.now();
    for (const [id, vence] of entregados) if (vence < ahora) entregados.delete(id);
    if (entregados.has(ev.eventoId)) return responder(res, 202, { duplicado: true });

    const { ruta, cuerpo: nativo } = haciaCad(ev);
    try {
      const r = await postJson(`${t.cadUrl.replace(/\/$/, '')}${ruta}`, JSON.stringify(nativo), t.tokenHaciaCad ? { authorization: `Bearer ${t.tokenHaciaCad}` } : {}, false);
      if (r.status >= 200 && r.status < 300) {
        entregados.set(ev.eventoId, ahora + VIGENCIA_IDS_MS);
        log(`[${t.cadId}] ${ev.folio} ${ev.tipo} entregado al CAD`);
        return responder(res, 202, {});
      }
      log(`[${t.cadId}] el CAD respondió ${r.status} a ${ev.tipo} de ${ev.folio}`);
    } catch (err) {
      log(`[${t.cadId}] el CAD no responde (${(err as Error).message})`);
    }
    return responder(res, 502, { codigo: 'cad_no_disponible' });
  }

  function autorizadoCad(t: Tenant, req: IncomingMessage) {
    const a = String(req.headers.authorization ?? '');
    return a.startsWith('Bearer ') && mismoToken(a.slice(7), t.tokenDesdeCad);
  }

  /** CAD → POL-IAQ. Se responde 202 al aceptarlo; la entrega a POL-IAQ sigue con reintentos. */
  async function eventoDelCad(t: Tenant, req: IncomingMessage, res: ServerResponse) {
    if (!autorizadoCad(t, req)) return responder(res, 401, { codigo: 'token_invalido' });
    let json: unknown;
    try { json = JSON.parse(await leerCuerpo(req)); } catch { return responder(res, 400, { codigo: 'json_invalido' }); }
    const p = EventoNativoSchema.safeParse(json);
    if (!p.success) return responder(res, 400, { codigo: 'evento_invalido', errores: p.error.issues.map((i) => i.path.join('.')) });
    const ev = desdeCad(p.data);
    responder(res, 202, {});
    void enviarEvento(t, ev, p.data.idEvento).catch((e) => log(`[${t.cadId}] ${(e as Error).message}`));
  }

  async function avlDelCad(t: Tenant, req: IncomingMessage, res: ServerResponse) {
    if (!autorizadoCad(t, req)) return responder(res, 401, { codigo: 'token_invalido' });
    let json: unknown;
    try { json = JSON.parse(await leerCuerpo(req)); } catch { return responder(res, 400, { codigo: 'json_invalido' }); }
    const p = AvlNativoSchema.safeParse(json);
    if (!p.success) return responder(res, 400, { codigo: 'avl_invalido' });
    const lista = avl.get(t.cadId) ?? [];
    for (const x of p.data.posiciones) {
      lista.push({ unidadId: x.unidad, lat: x.lat, lng: x.lon, rumbo: x.rumbo, en: x.fecha });
      // Si la unidad atiende un folio, su posición también va como unidad.posicion del folio.
      const folio = unidadFolio.get(`${t.cadId}|${x.unidad}`);
      if (folio) void enviarEvento(t, { tipo: 'unidad.posicion', folio, datos: { unidadId: x.unidad, lat: x.lat, lng: x.lon, rumbo: x.rumbo } }).catch(() => undefined);
    }
    avl.set(t.cadId, lista);
    if (lista.length >= MAX_LOTE_AVL) void vaciarAvl();
    responder(res, 202, { recibidas: p.data.posiciones.length });
  }

  const servidor = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && pathname === '/salud') return responder(res, 200, { ok: true, despliegue: config.despliegue, cads: Object.keys(config.tenants) });
    const m = /^\/(poliaq|cad)(?:\/([a-z0-9-]+))?\/(eventos|avl)$/.exec(pathname);
    if (req.method !== 'POST' || !m) return responder(res, 404, { codigo: 'ruta_desconocida' });
    const [, lado, cadId, recurso] = m;
    const t = tenantDe(cadId);
    if (!t) return responder(res, 404, { codigo: 'cad_desconocido' });
    const tarea = lado === 'poliaq' ? (recurso === 'eventos' ? desdePolIaq(t, req, res) : Promise.resolve(responder(res, 404, {})))
      : recurso === 'eventos' ? eventoDelCad(t, req, res) : avlDelCad(t, req, res);
    tarea.catch((err) => { if (!res.headersSent) responder(res, (err as Error).message === 'cuerpo_muy_grande' ? 413 : 500, { codigo: 'error' }); });
  });

  return {
    servidor,
    url() {
      const a = servidor.address();
      return typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
    },
    async cerrar() {
      clearInterval(relojAvl);
      await vaciarAvl().catch(() => undefined);
      cerrando = true;
      agente?.destroy();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
    estadoInterno() {
      return {
        eventosEntregados: [...entregados.keys()],
        secuencias: Object.fromEntries(secuencias),
        unidades: Object.fromEntries(unidadFolio),
        avlPendiente: [...avl.values()].reduce((n, l) => n + l.length, 0),
        colaSalida: enCola,
      };
    },
  };
}
