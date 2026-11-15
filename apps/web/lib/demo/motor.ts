/**
 * Motor de la demo pública (GitHub Pages).
 *
 * En la demo no hay servidor: este módulo hace en el navegador lo que hacen el
 * API (services/api) y el CAD simulado (services/cad-simulator), con la misma
 * lógica del paquete compartido: folio unificado, enrutamiento por geocerca,
 * máquina de estados, cuestionario, canalización, identidad (seudónimo o
 * anónimo), clasificación CNIE V 3.0 (y su corrección por el operador), asignación por cercanía con el GPS (AVL) de las unidades, tiempo
 * de llegada, tiempos por etapa contra su meta y calificación tras el cierre.
 *
 * Los datos viven en el localStorage de quien abre la demo y se comparten entre
 * pestañas del mismo navegador (BroadcastChannel). Son SOLO de demostración:
 * nada sale del navegador ni llega a un CAD real.
 *
 * Reloj: todas las horas (historial, mensajes, folios) son la hora real del
 * navegador, mostrada en la zona de Querétaro (America/Mexico_City). La opción
 * ×10 solo acelera la simulación (pasos del CAD simulado y avance de las
 * unidades); no adelanta el reloj. El acuse antes de escalar al C5 se cuenta
 * siempre en segundos reales, para que el operador alcance a recibirlo.
 */
import {
  CAD_ESTATAL_ID, CATALOGO_SEMILLA, ESTADOS, ESTADOS_FINALES, ETIQUETAS_CIUDADANO, FACTOR_CALLES, METAS_PROVISIONALES, MUNICIPIOS_PILOTO,
  PROTOCOLO_PROVISIONAL, UNIDADES_EJEMPLO, VELOCIDAD_EMERGENCIA_KMH,
  agruparPorCnie, aplica, candidatasPorCercania, canalizar, puedeDespachar, clasificacionDe, clasificarCnie, distanciaMetros, etiquetaCnie, subtipoCnie, validarCodigoCnie, enrutarPorUbicacion, esQueja, estimarRuta, generarFolio, incidentePorId, medirTiempos,
  minutosDe, permiteAnonimo, preguntasPara as preguntasProtocolo, preguntasPendientes, protocoloDe, puedeTransicionar, reportanteVisible, resolverEntradas,
  respuestasDe, resumirTiempos, transcripcion,
  type Canalizacion, type ClasificacionCnie, type Cuestionario, type EntradaCuestionario, type EstadoIncidente, type Identidad, type Opinion, type OpinionGuardada,
  type PreguntaProtocolo, type Punto, type UnidadAvl, type ValorRespuesta,
} from '@pol-iaq/shared/movil';

export const PROTOCOLO = PROTOCOLO_PROVISIONAL;
export const METAS = METAS_PROVISIONALES;
/** Segundos sin acuse antes de escalar al C5 (en producción son 30 s; en la demo hay más margen). */
export const ESPERA_ACUSE_SEG = 90;
/** Credenciales de la consola en la demo. */
export const OPERADOR_DEMO = { usuario: 'operador', clave: 'operador', nombre: 'Operador de demostración' };
const TOKEN_DEMO = 'demo-operador';
const CLAVE = 'poliaq.demo.v2';
const CANAL = 'poliaq-demo';

export const CADS_DEMO = [
  ...MUNICIPIOS_PILOTO.map((m) => ({ id: m.cadId, nombre: `CAD ${m.nombre}` })),
  { id: CAD_ESTATAL_ID, nombre: 'C5 Querétaro (estatal)' },
];

/** Unidades ficticias (las mismas de ejemplo del API en desarrollo). */
export const UNIDADES_DEMO = UNIDADES_EJEMPLO;

/** Lugares de prueba: uno por municipio piloto y uno fuera (va al C5). */
export const LUGARES_DEMO = [
  { id: 'qro', nombre: 'Centro de Querétaro', lat: 20.5888, lng: -100.3899, referencia: 'Jardín Zenea (ubicación de prueba)' },
  { id: 'corr', nombre: 'El Pueblito, Corregidora', lat: 20.539, lng: -100.442, referencia: 'Plaza principal (ubicación de prueba)' },
  { id: 'marq', nombre: 'La Cañada, El Marqués', lat: 20.61, lng: -100.32, referencia: 'Jardín principal (ubicación de prueba)' },
  { id: 'sjr', nombre: 'San Juan del Río (fuera del piloto)', lat: 20.389, lng: -99.996, referencia: 'Centro (ubicación de prueba)' },
];

export interface Unidad { unidadId: string; corporacion: string; etiqueta: string; etaMinutos?: number; lat?: number; lng?: number; rumbo?: number; distanciaMetros?: number }
export interface Mensaje { id: string; autor: 'ciudadano' | 'operador' | 'unidad'; nombreAutor?: string; texto: string; en: string }
export interface EvidenciaDemo { id: string; tipo: 'foto'; url: string; sha256: string; capturadoEn: string; bytes: number }

export interface ReporteDemo {
  folio: string;
  folioCad: string | null;
  cadId: string;
  municipioClave: string | null;
  incidenteId: string;
  /** Clasificación del CNIE V 3.0. Los reportes guardados antes del CNIE no la tienen. */
  cnie?: ClasificacionCnie | null;
  /** Correcciones del código hechas en la consola (bitácora). */
  correccionesCnie?: CorreccionCnie[];
  prioridad: Canalizacion['prioridad'];
  estado: EstadoIncidente;
  asistenciaDirecta: boolean;
  ubicacion: { lat: number; lng: number; precisionMetros?: number; referencia?: string };
  descripcion: string | null;
  /** Datos de la cuenta (verificados); lo que ven las autoridades depende de `identidad`. */
  ciudadano: { nombre: string; telefono: string; confiabilidad: number };
  identidad: Identidad;
  alias: string | null;
  cuestionario: Cuestionario;
  canalizacion: Canalizacion;
  unidad: Unidad | null;
  evidencias: EvidenciaDemo[];
  mensajes: Mensaje[];
  historial: { estado: EstadoIncidente; en: string; nota?: string }[];
  opinion: OpinionGuardada | null;
  creadoEn: string;
  actualizadoEn: string;
  /** Si el CAD simulado lo despacha solo (en lugar de la consola). */
  cadSimulado: { inicio: number; paso: number; enSitioEn?: number } | null;
  /** Lo cerró la demo automática, no un operador. */
  cerradoPorDemo?: boolean;
}

export interface CorreccionCnie { en: string; actor: string; de: string | null; a: string; secundario: string | null; motivo: string | null }

interface PosicionAvl { lat: number; lng: number; rumbo?: number; en: string }

interface Estado {
  version: 3;
  consecutivos: Record<string, number>;
  reportes: ReporteDemo[];
  /** GPS (AVL) simulado de cada unidad. */
  avl: Record<string, PosicionAvl>;
  /** Reloj de la simulación: avance = base + (real - baseReal) × factor. No es la hora que se muestra. */
  reloj: { baseReal: number; baseVirtual: number; factor: number };
  /** Último avance del GPS simulado (compartido entre pestañas para no mover doble). */
  ultimoTic?: number;
}

// ---------------------------------------------------------------------------
// Almacén local, reloj y avisos entre pestañas
// ---------------------------------------------------------------------------

const vacio = (): Estado => ({
  version: 3,
  consecutivos: {},
  reportes: [],
  avl: Object.fromEntries(UNIDADES_DEMO.map((u) => [u.unidadId, { ...u.base, en: new Date().toISOString() }])),
  reloj: { baseReal: Date.now(), baseVirtual: Date.now(), factor: 1 },
});

let memoria: Estado = vacio();
const oyentes = new Set<(folios: string[]) => void>();
let canal: BroadcastChannel | null = null;

function leer(): Estado {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t) {
      const e = JSON.parse(t) as Estado;
      if (e.version === 3) memoria = depurar(e);
      // Estado de una versión anterior de la demo: se migra (horas reales y código CNIE) en lugar de perderlo.
      else if ((e.version as number) === 2) memoria = depurar(migrarV2(e));
    }
  } catch { /* sin almacenamiento: queda en memoria */ }
  return memoria;
}

function escribir(e: Estado, folios: string[]) {
  memoria = e;
  try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* sin almacenamiento o lleno */ }
  oyentes.forEach((f) => f(folios));
  try { canal?.postMessage(folios); } catch { /* canal cerrado */ }
}

/** Lee, cambia y guarda en un solo paso síncrono. */
function cambiar<T>(f: (e: Estado) => { resultado: T; folios: string[] }): T {
  const e = leer();
  const { resultado, folios } = f(e);
  if (folios.length) escribir(e, folios);
  return resultado;
}

/** Reloj de la simulación (va ×10 si se acelera): solo mide el avance del CAD simulado y de las unidades. */
const virtual = (r: Estado['reloj'], real = Date.now()) => r.baseVirtual + (real - r.baseReal) * r.factor;
/** Hora real, en milisegundos. Es la que se guarda en el historial y se muestra. */
export const ahora = () => Date.now();
const ahoraIso = () => new Date().toISOString();

/** Los reportes de prueba se borran solos pasadas estas horas, para que la bandeja no muestre antigüedades de días. */
export const HORAS_DATOS_DEMO = 6;
function depurar(e: Estado): Estado {
  const limite = Date.now() - HORAS_DATOS_DEMO * 3600_000;
  const antes = e.reportes.length;
  e.reportes = e.reportes.filter((r) => new Date(r.creadoEn).getTime() >= limite);
  // Reportes guardados sin código CNIE (de antes del CNIE): se clasifican con la misma regla que uno nuevo.
  let clasificados = 0;
  for (const r of e.reportes) {
    if (r.cnie !== undefined) continue;
    r.cnie = clasificarCnie(r.incidenteId, respuestasDe(r.cuestionario.entradas));
    clasificados++;
  }
  if (e.reportes.length !== antes || clasificados) try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* sin almacenamiento */ }
  return e;
}

/** Versión 2: el reloj podía ir adelantado (×10). Lo que quedó con hora futura no es coherente y se descarta. */
function migrarV2(e: Estado): Estado {
  const ahoraReal = Date.now();
  e.version = 3;
  e.reportes = e.reportes.filter((r) => new Date(r.creadoEn).getTime() <= ahoraReal + 60_000);
  e.reloj = { baseReal: ahoraReal, baseVirtual: ahoraReal, factor: e.reloj?.factor ?? 1 };
  return e;
}
export const velocidad = () => leer().reloj.factor;

/** Cambia la velocidad del reloj de la demo sin saltos. */
export function fijarVelocidad(factor: number) {
  cambiar((e) => {
    const real = Date.now();
    e.reloj = { baseReal: real, baseVirtual: virtual(e.reloj, real), factor };
    return { resultado: null, folios: ['*'] };
  });
}

let arrancado = false;
/** Activa el aviso entre pestañas y el reloj (acuse al C5, CAD simulado y GPS de las unidades). */
export function arrancar() {
  if (arrancado || typeof window === 'undefined') return;
  arrancado = true;
  try {
    canal = new BroadcastChannel(CANAL);
    canal.onmessage = (m) => { leer(); oyentes.forEach((f) => f(m.data as string[])); };
  } catch { canal = null; }
  window.addEventListener('storage', (ev) => { if (ev.key === CLAVE) { leer(); oyentes.forEach((f) => f([])); } });
  setInterval(tic, 1000);
}

export function escuchar(f: (folios: string[]) => void) {
  arrancar();
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

export function borrarTodo() {
  const factor = leer().reloj.factor;
  const e = vacio();
  e.reloj.factor = factor;
  escribir(e, ['*']);
}

// ---------------------------------------------------------------------------
// Errores con los mismos códigos que el API
// ---------------------------------------------------------------------------

export class ErrorDemo extends Error {
  constructor(readonly status: number, readonly codigo: string, readonly mensaje?: string) { super(mensaje ?? codigo); }
}

/** El mismo 400 que el API para un código CNIE inexistente, retirado o mal formado. */
function exigirCnie(codigo: string) {
  const v = validarCodigoCnie(codigo);
  if (!v.ok) throw new ErrorDemo(400, `cnie_${v.error}`, v.mensaje);
  return v.incidente;
}
const codigoDe = (c: ClasificacionCnie | null | undefined) => c?.incidente?.codigo ?? c?.subtipo.codigo ?? null;

const id = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function transicionar(r: ReporteDemo, estado: EstadoIncidente, nota?: string) {
  if (r.estado === estado) return;
  if (!puedeTransicionar(r.estado, estado)) throw new ErrorDemo(409, 'transicion_invalida');
  r.estado = estado;
  r.historial.push({ estado, en: ahoraIso(), ...(nota && { nota }) });
}

// ---------------------------------------------------------------------------
// Lado ciudadano (lo que hace /v1/reportes)
// ---------------------------------------------------------------------------

export const CATALOGO = CATALOGO_SEMILLA;
export { permiteAnonimo };

/**
 * Preguntas del formulario: las obligatorias del protocolo que aplican con lo ya
 * contestado (las condicionales aparecen al contestar la que las activa).
 */
export function preguntasPara(incidenteId: string, respuestas: Record<string, ValorRespuesta> = {}): PreguntaProtocolo[] {
  return preguntasProtocolo(PROTOCOLO, incidenteId).filter((q) => q.obligatoria && aplica(q, respuestas));
}

export function recomendacionesPara(incidenteId: string): string[] {
  return protocoloDe(PROTOCOLO, incidenteId)?.recomendaciones ?? [];
}

export interface NuevoReporte {
  incidenteId: string;
  /** Lugar de prueba o ubicación real del navegador. */
  lugarId?: string;
  ubicacion?: { lat: number; lng: number; precisionMetros?: number; referencia?: string };
  descripcion?: string;
  respuestas: EntradaCuestionario[];
  nombre: string;
  telefono: string;
  identidad?: Identidad;
  alias?: string;
  asistenciaDirecta?: boolean;
  fotos?: Omit<EvidenciaDemo, 'id'>[];
  /** Solo "Otra emergencia": incidente CNIE elegido en el catálogo completo. */
  codigoCnie?: string;
  /** true: el CAD simulado lo despacha solo; false: lo despacha quien use la consola. */
  cadSimulado: boolean;
}

export function crearReporte(d: NuevoReporte): ReporteDemo {
  const incidente = incidentePorId(d.incidenteId);
  const lugar = d.ubicacion ?? LUGARES_DEMO.find((l) => l.id === d.lugarId);
  if (!incidente || !lugar) throw new ErrorDemo(400, 'datos_invalidos');
  const identidad = d.identidad ?? 'completa';
  if (d.codigoCnie) {
    if (incidente.id !== 'otro') throw new ErrorDemo(400, 'cnie_no_aplica');
    exigirCnie(d.codigoCnie);
  }
  const respuestasDadas = respuestasDe(resolverEntradas(PROTOCOLO, incidente.id, d.respuestas, 'formulario').validas);
  if (identidad === 'anonimo' && !permiteAnonimo(incidente.id, respuestasDadas, d.codigoCnie)) throw new ErrorDemo(400, 'anonimo_no_permitido');
  if (identidad === 'seudonimo' && !d.alias?.trim()) throw new ErrorDemo(400, 'falta_seudonimo');
  const cnie = clasificarCnie(incidente.id, respuestasDadas, d.codigoCnie);
  return cambiar((e) => {
    const ruta = enrutarPorUbicacion(lugar.lat, lugar.lng);
    const iso = ahoraIso();
    const anio = new Date(iso).getUTCFullYear();
    const clave = ruta.municipio?.claveInegi ?? null;
    const k = `${clave ?? '000'}-${anio}`;
    e.consecutivos[k] = (e.consecutivos[k] ?? 0) + 1;
    const folio = generarFolio(clave, anio, e.consecutivos[k]);
    const { validas } = resolverEntradas(PROTOCOLO, incidente.id, d.respuestas, 'formulario', iso);
    const canalizacion = canalizar(PROTOCOLO, incidente, respuestasDe(validas), { asistenciaDirecta: d.asistenciaDirecta });
    const r: ReporteDemo = {
      folio,
      folioCad: null,
      cadId: ruta.cadId,
      municipioClave: clave,
      incidenteId: incidente.id,
      cnie,
      correccionesCnie: [],
      prioridad: canalizacion.prioridad,
      estado: 'recibido',
      asistenciaDirecta: !!d.asistenciaDirecta,
      ubicacion: { lat: lugar.lat, lng: lugar.lng, precisionMetros: ('precisionMetros' in lugar && lugar.precisionMetros) || 12, referencia: lugar.referencia },
      descripcion: d.descripcion?.trim() || null,
      ciudadano: { nombre: d.nombre.trim() || 'Ciudadano de prueba', telefono: d.telefono, confiabilidad: 1 },
      identidad,
      alias: identidad === 'seudonimo' ? d.alias!.trim() : null,
      cuestionario: { protocoloVersion: PROTOCOLO.version, protocoloEstado: PROTOCOLO.estado, entradas: validas },
      canalizacion,
      unidad: null,
      evidencias: (d.fotos ?? []).map((f) => ({ ...f, id: id() })),
      mensajes: [],
      historial: [{ estado: 'recibido', en: iso }],
      opinion: null,
      creadoEn: iso,
      actualizadoEn: iso,
      cadSimulado: d.cadSimulado ? { inicio: virtual(e.reloj), paso: 0 } : null,
    };
    e.reportes.push(r);
    return { resultado: r, folios: [folio] };
  });
}

export function reporte(folio: string): ReporteDemo | undefined {
  return leer().reportes.find((r) => r.folio === folio);
}

function delFolio(e: Estado, folio: string) {
  const r = e.reportes.find((x) => x.folio === folio);
  if (!r) throw new ErrorDemo(404, 'folio_no_encontrado');
  return r;
}

export function mensajeCiudadano(folio: string, texto: string) {
  return cambiar((e) => {
    const r = delFolio(e, folio);
    if (ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_finalizado');
    r.mensajes.push({ id: id(), autor: 'ciudadano', texto, en: ahoraIso() });
    r.actualizadoEn = ahoraIso();
    return { resultado: r, folios: [folio] };
  });
}

export function agregarFoto(folio: string, foto: Omit<EvidenciaDemo, 'id'>) {
  return cambiar((e) => {
    const r = delFolio(e, folio);
    if (ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_finalizado');
    r.evidencias.push({ ...foto, id: id() });
    r.actualizadoEn = ahoraIso();
    return { resultado: r, folios: [folio] };
  });
}

export function cancelar(folio: string) {
  return cambiar((e) => {
    const r = delFolio(e, folio);
    if (ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_finalizado');
    transicionar(r, 'cancelado', 'Cancelado por el ciudadano');
    r.cadSimulado = null;
    r.actualizadoEn = ahoraIso();
    return { resultado: r, folios: [folio] };
  });
}

/** Calificación y queja, una vez y solo cuando el reporte terminó. */
export function opinar(folio: string, o: Opinion) {
  return cambiar((e) => {
    const r = delFolio(e, folio);
    if (!ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_en_curso');
    if (r.opinion) throw new ErrorDemo(409, 'opinion_ya_registrada');
    r.opinion = { ...o, queja: esQueja(o), en: ahoraIso() };
    r.actualizadoEn = ahoraIso();
    return { resultado: r, folios: [folio] };
  });
}

export const etiquetaCiudadano = (e: EstadoIncidente) => ETIQUETAS_CIUDADANO[e];
export const nombreCad = (cadId: string) => CADS_DEMO.find((c) => c.id === cadId)?.nombre ?? cadId;
export const tiemposDe = (r: Pick<ReporteDemo, 'historial' | 'prioridad'>) => medirTiempos(r.historial, r.prioridad, ahora());

// ---------------------------------------------------------------------------
// Unidades: GPS (AVL) y asignación por cercanía
// ---------------------------------------------------------------------------

const activos = (e: Estado) => e.reportes.filter((r) => !ESTADOS_FINALES.includes(r.estado));

function unidadesAvl(e: Estado, cadId: string): UnidadAvl[] {
  const ocupadas = new Set(activos(e).filter((r) => r.unidad).map((r) => r.unidad!.unidadId));
  return UNIDADES_DEMO.filter((u) => puedeDespachar(cadId, u.cadId)).map((u) => ({
    unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, disponible: !ocupadas.has(u.unidadId), posicion: e.avl[u.unidadId],
  }));
}

function asignar(e: Estado, r: ReporteDemo, unidadId: string) {
  const u = UNIDADES_DEMO.find((x) => x.unidadId === unidadId && puedeDespachar(r.cadId, x.cadId));
  if (!u) throw new ErrorDemo(400, 'unidad_desconocida');
  const p = e.avl[u.unidadId] ?? u.base;
  const ruta = estimarRuta(p, r.ubicacion);
  if (r.estado === 'recibido') transicionar(r, 'validado');
  transicionar(r, 'asignado');
  r.unidad = { unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, etaMinutos: minutosDe(ruta.segundos), lat: p.lat, lng: p.lng, distanciaMetros: ruta.metros };
}

function asignarCercana(e: Estado, r: ReporteDemo, obligatorio: boolean) {
  const c = candidatasPorCercania(unidadesAvl(e, r.cadId), r.ubicacion, r.canalizacion.corporaciones[0])[0];
  if (!c) {
    if (obligatorio) throw new ErrorDemo(409, 'sin_unidades_disponibles');
    return;
  }
  asignar(e, r, c.unidad.unidadId);
}

const rumboDe = (a: Punto, b: Punto) => (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI;

/** Mueve la unidad hacia el reporte a velocidad de emergencia y recalcula su llegada. */
function moverUnidad(e: Estado, r: ReporteDemo, dtSeg: number) {
  if (!r.unidad) return false;
  const p = e.avl[r.unidad.unidadId];
  if (!p) return false;
  const restante = distanciaMetros(p, r.ubicacion);
  // Avance en línea recta equivalente al recorrido por calles.
  const avance = ((VELOCIDAD_EMERGENCIA_KMH * 1000) / 3600) * dtSeg / FACTOR_CALLES;
  const t = restante <= avance || restante < 15 ? 1 : avance / restante;
  const nueva = { lat: p.lat + (r.ubicacion.lat - p.lat) * t, lng: p.lng + (r.ubicacion.lng - p.lng) * t };
  const rumbo = rumboDe(p, r.ubicacion);
  e.avl[r.unidad.unidadId] = { ...nueva, rumbo, en: ahoraIso() };
  const ruta = estimarRuta(nueva, r.ubicacion);
  Object.assign(r.unidad, { lat: nueva.lat, lng: nueva.lng, rumbo, distanciaMetros: ruta.metros, etaMinutos: t === 1 ? 0 : minutosDe(ruta.segundos) });
  return t === 1;
}

// ---------------------------------------------------------------------------
// Lado operador (lo que hace /v1/operador)
// ---------------------------------------------------------------------------

export type AccionDemo =
  | { accion: 'recibir' }
  | { accion: 'asignar'; unidadId: string; etaMinutos?: number }
  | { accion: 'asignar_cercana' }
  | { accion: 'estado'; estado: 'en_camino' | 'en_sitio' | 'cerrado' | 'improcedente'; nota?: string }
  | { accion: 'mensaje'; texto: string }
  | { accion: 'transferir'; cadDestinoId: string; motivo?: string }
  | { accion: 'reclasificar'; codigoCnie: string; codigoCnieSecundario?: string | null; motivo?: string };

function yo() {
  return {
    operador: { usuario: OPERADOR_DEMO.usuario, nombre: OPERADOR_DEMO.nombre, cads: ['*'] },
    // En la demo todos los CAD están en modo consola para poder despachar desde aquí.
    cads: CADS_DEMO.map((c) => ({ ...c, modo: 'consola' as const, mio: true })),
    protocolo: { version: PROTOCOLO.version, estado: PROTOCOLO.estado },
  };
}

function exigirToken(token: string | null) {
  if (token !== TOKEN_DEMO) throw new ErrorDemo(401, 'no_autenticado');
}

export function vistaOperador(r: ReporteDemo) {
  const incidente = incidentePorId(r.incidenteId);
  const pendientes = preguntasPendientes(PROTOCOLO, r.incidenteId, respuestasDe(r.cuestionario.entradas));
  const escalaAlC5En = r.estado === 'recibido' && !r.folioCad && !r.cadSimulado && r.cadId !== CAD_ESTATAL_ID
    ? new Date(new Date(r.creadoEn).getTime() + ESPERA_ACUSE_SEG * 1000).toISOString()
    : null;
  return {
    folio: r.folio,
    folioCad: r.folioCad,
    cadId: r.cadId,
    incidenteId: r.incidenteId,
    incidente: incidente?.nombreCorto ?? r.incidenteId,
    categoria: incidente?.categoria ?? null,
    codigoCnie: r.cnie?.incidente?.codigo ?? null,
    cnie: r.cnie ?? null,
    cnieEtiqueta: r.cnie ? etiquetaCnie(r.cnie) : null,
    correccionesCnie: r.correccionesCnie ?? [],
    prioridad: r.prioridad,
    estado: r.estado,
    asistenciaDirecta: r.asistenciaDirecta,
    escenarioId: null,
    ubicacion: r.ubicacion,
    descripcion: r.descripcion,
    reportante: reportanteVisible(r, r.ciudadano),
    cuestionario: { ...r.cuestionario, transcripcion: transcripcion(r.cuestionario), pendientes: pendientes.map((q) => q.texto) },
    canalizacion: r.canalizacion,
    recomendaciones: recomendacionesPara(r.incidenteId),
    unidad: r.unidad,
    evidencias: r.evidencias.map((x) => ({ id: x.id, tipo: x.tipo, url: x.url, sha256: x.sha256, expiraEn: '' })),
    mensajes: r.mensajes,
    historial: r.historial,
    tiempos: tiemposDe(r),
    opinion: r.opinion,
    automatico: !!r.cadSimulado,
    cerradoPorDemo: !!r.cerradoPorDemo,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
    escalaAlC5En,
    operable: true,
    transiciones: ESTADOS.filter((x) => puedeTransicionar(r.estado, x)),
  };
}

export const operador = {
  sesion(usuario: string, clave: string) {
    if (usuario !== OPERADOR_DEMO.usuario || clave !== OPERADOR_DEMO.clave) throw new ErrorDemo(401, 'credenciales_invalidas');
    return { token: TOKEN_DEMO, ...yo() };
  },
  yo(token: string | null) {
    exigirToken(token);
    return yo();
  },
  reportes(token: string | null, todos: boolean) {
    exigirToken(token);
    const lista = leer().reportes.filter((r) => todos || !ESTADOS_FINALES.includes(r.estado));
    return { reportes: lista.map(vistaOperador) };
  },
  unidades(token: string | null) {
    exigirToken(token);
    const e = leer();
    const ocupadas = new Map(activos(e).filter((r) => r.unidad).map((r) => [r.unidad!.unidadId, r.folio]));
    return {
      unidades: UNIDADES_DEMO.map(({ base: _base, ...u }) => ({ ...u, ocupadaEn: ocupadas.get(u.unidadId) ?? null, posicion: e.avl[u.unidadId] ?? null })),
    };
  },
  tiempos(token: string | null) {
    exigirToken(token);
    const lista = leer().reportes;
    const mediciones = lista.map((r) => ({ r, t: tiemposDe(r) }));
    const calificaciones = lista.flatMap((r) => (r.opinion ? [r.opinion.calificacion] : []));
    return {
      metas: METAS,
      resumen: resumirTiempos(mediciones.map((m) => m.t)),
      reportes: mediciones.map(({ r, t }) => ({ folio: r.folio, cadId: r.cadId, prioridad: r.prioridad, estado: r.estado, creadoEn: r.creadoEn, cnie: r.cnie ?? null, tiempos: t, opinion: r.opinion })),
      quejas: lista.filter((r) => r.opinion?.queja).length,
      calificacionPromedio: calificaciones.length ? Math.round((calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length) * 10) / 10 : null,
      porCnie: agruparPorCnie(
        mediciones.map(({ r, t }) => ({ cnie: r.cnie, tiempos: t, queja: !!r.opinion?.queja })),
        (c, n) => subtipoCnie(c)?.nombreCorto ?? n,
      ),
    };
  },
  accion(token: string | null, folio: string, a: AccionDemo) {
    exigirToken(token);
    return cambiar((e) => {
      const r = delFolio(e, folio);
      // La clasificación se puede corregir aun cerrado el reporte (sirve a la estadística).
      if (ESTADOS_FINALES.includes(r.estado) && a.accion !== 'reclasificar') throw new ErrorDemo(409, 'reporte_cerrado');
      // Si alguien despacha a mano, el CAD simulado deja de mover ese reporte (corregir el código no cuenta).
      if (a.accion !== 'reclasificar') r.cadSimulado = null;
      aplicar(e, r, a, OPERADOR_DEMO.nombre);
      r.actualizadoEn = ahoraIso();
      return { resultado: vistaOperador(r), folios: [folio] };
    });
  },
};

function aplicar(e: Estado, r: ReporteDemo, a: AccionDemo, autor: string) {
  switch (a.accion) {
    case 'recibir':
      if (r.estado !== 'recibido' && r.estado !== 'transferido') throw new ErrorDemo(409, 'ya_recibido');
      r.folioCad = r.folio;
      transicionar(r, 'validado', 'Recibido por el operador');
      // Asignación automática: la unidad disponible más cercana (el operador puede cambiarla).
      asignarCercana(e, r, false);
      break;
    case 'asignar':
      asignar(e, r, a.unidadId);
      break;
    case 'asignar_cercana':
      asignarCercana(e, r, true);
      break;
    case 'estado':
      transicionar(r, a.estado, a.nota);
      if (a.estado === 'en_sitio' && r.unidad) {
        e.avl[r.unidad.unidadId] = { lat: r.ubicacion.lat, lng: r.ubicacion.lng, en: ahoraIso() };
        Object.assign(r.unidad, { etaMinutos: 0, lat: r.ubicacion.lat, lng: r.ubicacion.lng, distanciaMetros: 0 });
      }
      break;
    case 'mensaje':
      r.mensajes.push({ id: id(), autor: 'operador', nombreAutor: autor, texto: a.texto, en: ahoraIso() });
      break;
    case 'reclasificar': {
      exigirCnie(a.codigoCnie);
      if (a.codigoCnieSecundario) exigirCnie(a.codigoCnieSecundario);
      const antes = r.cnie ?? null;
      const secundario = a.codigoCnieSecundario === null ? null : a.codigoCnieSecundario ?? antes?.secundario?.codigo ?? null;
      r.cnie = clasificacionDe(a.codigoCnie, 'operador', secundario);
      (r.correccionesCnie ??= []).push({ en: ahoraIso(), actor: `operador:${OPERADOR_DEMO.usuario}`, de: codigoDe(antes), a: a.codigoCnie, secundario, motivo: a.motivo?.trim() || null });
      break;
    }
    case 'transferir':
      if (a.cadDestinoId === r.cadId || !CADS_DEMO.some((c) => c.id === a.cadDestinoId)) throw new ErrorDemo(400, 'cad_destino_invalido');
      transicionar(r, 'transferido', a.motivo ?? `Transferido a ${nombreCad(a.cadDestinoId)}`);
      r.cadId = a.cadDestinoId;
      r.unidad = null;
      r.folioCad = null;
      break;
  }
}

// ---------------------------------------------------------------------------
// Reloj: escalamiento al C5, CAD simulado y GPS de las unidades
// ---------------------------------------------------------------------------

/** Pasos del CAD simulado, en segundos del reloj de la simulación (×1 o ×10) desde que se creó el reporte. */
/** El cierre automático solo existe en la demo, para no esperar al operador. */
export const NOTA_CIERRE_DEMO = 'Cerrado automáticamente por la demo (en el servicio real lo cierra el operador)';
const SIM = { recibe: 20, asigna: 35, mensaje: 45, sale: 60, cierraTrasLlegar: 90 };
function tic() {
  cambiar((e) => {
    const t = virtual(e.reloj);
    const real = Date.now();
    const dt = e.ultimoTic ? Math.min(2 * e.reloj.factor, Math.max(0, (t - e.ultimoTic) / 1000)) : 0;
    e.ultimoTic = t;
    const folios: string[] = [];
    for (const r of e.reportes) {
      if (ESTADOS_FINALES.includes(r.estado)) continue;
      let cambio = false;
      // Sin acuse a tiempo, el reporte pasa al C5 con el mismo folio.
      if (!r.cadSimulado && r.estado === 'recibido' && !r.folioCad && r.cadId !== CAD_ESTATAL_ID
        && real - new Date(r.creadoEn).getTime() > ESPERA_ACUSE_SEG * 1000) {
        r.historial.push({ estado: 'recibido', en: ahoraIso(), nota: `${nombreCad(r.cadId)} no acusó en ${ESPERA_ACUSE_SEG} s; se escaló al C5` });
        r.cadId = CAD_ESTATAL_ID;
        cambio = true;
      }
      if (r.cadSimulado) cambio = avanzarSimulador(e, r, t) || cambio;
      // GPS: la unidad en camino se mueve sola (con o sin CAD simulado).
      if (r.estado === 'en_camino' && r.unidad) {
        // Se guarda aunque dt sea 0 para que el siguiente tic tenga desde dónde medir.
        const llego = dt > 0 && moverUnidad(e, r, dt);
        cambio = true;
        if (llego) {
          transicionar(r, 'en_sitio', 'Llegada confirmada por GPS');
          if (r.cadSimulado) r.cadSimulado.enSitioEn = t;
        }
      }
      if (cambio) {
        r.actualizadoEn = ahoraIso();
        folios.push(r.folio);
      }
    }
    // Una unidad que terminó vuelve a su zona de patrullaje: si se quedara en el lugar del último
    // reporte, el siguiente reporte en el mismo sitio mediría un traslado de 0 s.
    const ocupadas = new Set(activos(e).filter((r) => r.unidad).map((r) => r.unidad!.unidadId));
    for (const u of UNIDADES_DEMO) {
      const p = e.avl[u.unidadId];
      if (!ocupadas.has(u.unidadId) && p && distanciaMetros(p, u.base) > 15) {
        e.avl[u.unidadId] = { ...u.base, en: ahoraIso() };
        if (!folios.length) folios.push('*');
      }
    }
    return { resultado: null, folios };
  });
}

function avanzarSimulador(e: Estado, r: ReporteDemo, t: number): boolean {
  const sim = r.cadSimulado!;
  const s = (t - sim.inicio) / 1000;
  const cad = nombreCad(r.cadId);
  let cambio = false;
  if (sim.paso === 0 && s >= SIM.recibe) {
    r.folioCad = `${r.cadId.toUpperCase()}-${String(Date.now()).slice(-5)}`;
    transicionar(r, 'validado', `Recibido por ${cad} (CAD simulado)`);
    sim.paso = 1; cambio = true;
  }
  if (sim.paso === 1 && s >= SIM.asigna) {
    asignarCercana(e, r, false);
    sim.paso = 2; cambio = true;
  }
  if (sim.paso === 2 && s >= SIM.mensaje) {
    r.mensajes.push({ id: id(), autor: 'operador', nombreAutor: `Operador de ${cad} (simulado)`, texto: 'Recibimos tu reporte. Asignamos la unidad más cercana.', en: ahoraIso() });
    sim.paso = 3; cambio = true;
  }
  if (sim.paso === 3 && s >= SIM.sale && r.estado === 'asignado') {
    transicionar(r, 'en_camino');
    sim.paso = 4; cambio = true;
  }
  if (sim.paso === 4 && sim.enSitioEn && t - sim.enSitioEn >= SIM.cierraTrasLlegar * 1000) {
    transicionar(r, 'cerrado', NOTA_CIERRE_DEMO);
    r.cadSimulado = null;
    r.cerradoPorDemo = true;
    cambio = true;
  }
  return cambio;
}
