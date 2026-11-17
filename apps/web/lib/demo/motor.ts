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
 * unidades); no adelanta el reloj. El acuse antes de escalar al CQ CIAS se cuenta
 * siempre en segundos reales, para que el operador alcance a recibirlo.
 */
import {
  CAD_ESTATAL_ID, CAD_IDS, CASOS_PRUEBA_CAD, CATALOGO_SEMILLA, CORPORACIONES, ESTADOS, ESTADOS_FINALES, ETIQUETAS_CIUDADANO, FACTOR_CALLES, METAS_PROVISIONALES, TIPOS_UNIDAD,
  AltaCadSchema, casosPendientes, cerrarMes, csvAjustesSesnsp, csvFolios, csvSesnsp, enRango, estadistica, estadisticaPublica, mesLocal, municipioPorCad, municipioPorClave, claveCompleta,
  nombreDeCad, puntoInterior, rangoPeriodo, tipoUnidadDe, xlsxSesnsp, MUNICIPIOS_QRO, NOMBRE_RESPALDO_ESTATAL, TEXTO_RESPALDO, ACTOR_ESTADO, rutaDe, textoRespaldo, type RutaFolio,
  type CierreMensual, type FilaEstadistica, type Periodo, type TipoUnidad,
  PROTOCOLO_PROVISIONAL, UNIDADES_EJEMPLO, VELOCIDAD_EMERGENCIA_KMH,
  agruparPorCnie, aplica, candidatasPorCercania, canalizar, puedeDespachar, clasificacionDe, clasificarCnie, distanciaMetros, etiquetaCnie, subtipoCnie, validarCodigoCnie, enrutarPorUbicacion, esQueja, estimarRuta, generarFolio, incidentePorId, medirTiempos,
  minutosDe, permiteAnonimo, preguntasPara as preguntasProtocolo, preguntasPendientes, protocoloDe, puedeTransicionar, reportanteVisible, resolverEntradas,
  respuestasDe, resumirTiempos, transcripcion, esMalUso, tipoCnie, UMBRALES_SEMAFORO_PREDETERMINADOS, validarUmbrales, filaFolio,
  type UmbralesSemaforo, type OrigenFolio, type TipoTelefono, type FilaFolio, type Prioridad,
  type Canalizacion, type ClasificacionCnie, type Cuestionario, type EntradaCuestionario, type EstadoIncidente, type Identidad, type Opinion, type OpinionGuardada,
  type PreguntaProtocolo, type Punto, type UnidadAvl, type ValorRespuesta,
} from '@pol-iaq/shared/movil';

export const PROTOCOLO = PROTOCOLO_PROVISIONAL;
export const METAS = METAS_PROVISIONALES;
/** Segundos sin acuse antes de escalar al CQ CIAS (en producción son 30 s; en la demo hay más margen). */
export const ESPERA_ACUSE_SEG = 90;
/** Credenciales de la consola en la demo. */
export const OPERADOR_DEMO = { usuario: 'operador', clave: 'operador', nombre: 'Operador de demostración' };
const TOKEN_DEMO = 'demo-operador';
const CLAVE = 'poliaq.demo.v2';
const CANAL = 'poliaq-demo';

/** Los 18 municipios (clave INEGI de 5 dígitos) y el respaldo estatal (CQ CIAS). */
export const CADS_DEMO = CAD_IDS.map((id) => ({
  id,
  nombre: nombreDeCad(id),
  clave: municipioPorCad(id)?.clave ?? null,
  piloto: municipioPorCad(id)?.piloto ?? false,
}));

/** Unidades ficticias (las mismas de ejemplo del API en desarrollo). */
export const UNIDADES_DEMO = UNIDADES_EJEMPLO;

/**
 * Lugares de prueba: uno por municipio piloto, San Juan del Río (para probar el alta) y un punto dentro
 * de cada uno de los otros 14 municipios (calculado de su polígono de INEGI 2022).
 */
const LUGARES_FIJOS = [
  { id: 'qro', nombre: 'Centro de Querétaro', lat: 20.5888, lng: -100.3899, referencia: 'Jardín Zenea (ubicación de prueba)', clave: '22014' },
  { id: 'corr', nombre: 'El Pueblito, Corregidora', lat: 20.539, lng: -100.442, referencia: 'Plaza principal (ubicación de prueba)', clave: '22006' },
  { id: 'marq', nombre: 'La Cañada, El Marqués', lat: 20.61, lng: -100.32, referencia: 'Jardín principal (ubicación de prueba)', clave: '22011' },
  { id: 'sjr', nombre: 'San Juan del Río', lat: 20.389, lng: -99.996, referencia: 'Centro (ubicación de prueba)', clave: '22016' },
];
export const LUGARES_DEMO: { id: string; nombre: string; lat: number; lng: number; referencia: string; clave: string; destacado: boolean }[] = [
  ...LUGARES_FIJOS.map((l) => ({ ...l, destacado: true })),
  ...MUNICIPIOS_QRO.filter((m) => !LUGARES_FIJOS.some((l) => l.clave === m.clave)).flatMap((m) => {
    const p = puntoInterior(m.geocerca);
    return p ? [{ id: `m${m.clave}`, nombre: m.nombre, lat: p.lat, lng: p.lng, referencia: `Punto de prueba dentro de ${m.nombre}`, clave: m.clave, destacado: false }] : [];
  }),
];

/** Etiqueta corta del destino para el formulario: «va a su CAD local» o «va al CQ CIAS: municipio sin CAD conectado». */
export function etiquetaDestino(lugarId: string): string {
  const d = destinoDeLugar(lugarId);
  return d.respaldo ? d.texto.replace(/^Lo atiende el /, 'va al ') : 'va a su CAD local';
}

/**
 * A quién llega hoy un reporte en ese lugar, según el estado de la demo (alta, capacidad):
 * «Lo atiende CAD San Juan del Río» o «Lo atiende el CQ CIAS: municipio sin CAD conectado».
 */
export function destinoDeLugar(lugarId: string, anonimo = false): { cadId: string; texto: string; respaldo: boolean } {
  const l = LUGARES_DEMO.find((x) => x.id === lugarId);
  if (!l) return { cadId: CAD_ESTATAL_ID, texto: `Lo atiende el ${NOMBRE_RESPALDO_ESTATAL}`, respaldo: true };
  const e = leer();
  const r = enrutarPorUbicacion(l.lat, l.lng, (cadId) => cadConectado(e, cadId), undefined, { capacidad: (cadId) => capacidad(e, cadId), anonimo });
  return r.motivo
    ? { cadId: r.cadId, texto: `Lo atiende el ${NOMBRE_RESPALDO_ESTATAL}: ${TEXTO_RESPALDO[r.motivo]}${r.detalle ? ` (${r.detalle})` : ''}`, respaldo: true }
    : { cadId: r.cadId, texto: `Lo atiende ${nombreDeCad(r.cadId)}`, respaldo: false };
}

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
  /** Cómo se enrutó al crearse (CAD de origen, motivo del respaldo y canal). */
  ruta?: RutaFolio;
  /** Por dónde entró: la app ciudadana o una llamada al 911 capturada en la consola. Sin dato = app. */
  origen?: OrigenFolio;
  /** Solo en altas por 911: si la llamada fue de celular o de teléfono fijo. */
  tipoTelefono?: TipoTelefono | null;
  /** Operador que capturó la llamada al 911. */
  altaPor?: string | null;
}

export interface CorreccionCnie {
  en: string; actor: string; de: string | null; a: string; secundario: string | null; motivo: string | null;
  /** Tipo CNIE antes y después (trazabilidad de la recatalogación a Mal Uso del servicio). */
  tipoDe?: string | null; tipoA?: string;
  /** Recatalogación a Mal Uso del servicio (Improcedentes), tipo 7. */
  malUso?: boolean;
}

/** Reportante dado de alta (por la app o por una llamada al 911). Clave: los 10 dígitos del teléfono. */
export interface ReportanteDemo { telefono: string; nombre: string; origen: OrigenFolio; registradoEn: string; actualizadoEn: string }

interface PosicionAvl { lat: number; lng: number; rumbo?: number; en: string }

/** Alta de un municipio en la demo (sin secretos reales: la demo no guarda ninguno). */
export interface RegistroDemo {
  cadId: string;
  nombre: string;
  clave: string | null;
  modo: 'webhook' | 'consola';
  estado: 'pruebas' | 'activo' | 'suspendido';
  webhookUrl: string | null;
  contactoTecnico: { nombre: string; correo: string };
  casosPrueba: Record<string, { ok: boolean; en: string; detalle?: string }>;
  actualizadoEn: string;
}

export interface UnidadRegistradaDemo {
  unidadId: string; cadId: string; tipo: TipoUnidad; corporacion: string; etiqueta: string; activa: boolean;
  base: { lat: number; lng: number }; registradaEn: string;
}

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
  /** Alta de municipios hecha en la demo. */
  registros?: Record<string, RegistroDemo>;
  unidadesRegistradas?: UnidadRegistradaDemo[];
  /** Cierres mensuales SESNSP (congelados). `prueba`: cierre del mes en curso hecho solo para probar en la demo. */
  cierres?: (CierreMensual & { prueba?: boolean })[];
  /** CAD marcados «sin operador disponible»: sus reportes nuevos van al CQ CIAS. */
  sinOperador?: Record<string, { en: string; nota: string | null }>;
  /** Reportantes dados de alta (app o 911), por teléfono de 10 dígitos. */
  reportantes?: Record<string, ReportanteDemo>;
  /** Umbrales del semáforo de la bandeja (fracción de la meta de llegada). */
  umbrales?: UmbralesSemaforo;
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
  /** Solo alta por 911 (consola). */
  origen?: OrigenFolio;
  tipoTelefono?: TipoTelefono;
  altaPor?: string;
  /** Solo alta por 911: prioridad operativa que fijó el operador (si no, la del protocolo). */
  prioridad?: Prioridad;
  /** Solo alta por 911: código CNIE que eligió el operador (cualquier opción, salvo Mal Uso). */
  codigoCnieOperador?: string;
}

/** Los 10 dígitos de un teléfono mexicano (acepta +52, espacios y guiones). null si no son 10. */
export function telefonoNormal(t: string): string | null {
  const d = t.replace(/\D/g, '').replace(/^52(?=\d{10}$)/, '');
  return /^\d{10}$/.test(d) ? d : null;
}

function registrar(e: Estado, nombre: string, telefono: string, origen: OrigenFolio) {
  const tel = telefonoNormal(telefono);
  if (!tel || !nombre.trim()) return;
  const r = (e.reportantes ??= {});
  const iso = ahoraIso();
  r[tel] = { telefono: tel, nombre: nombre.trim(), origen: r[tel]?.origen ?? origen, registradoEn: r[tel]?.registradoEn ?? iso, actualizadoEn: iso };
}

/** Alta del ciudadano en la app de la demo: queda como reportante registrado (lo encuentra la consola al capturar una llamada). */
export function registrarCiudadano(nombre: string, telefono: string) {
  cambiar((e) => { registrar(e, nombre, telefono, 'app'); return { resultado: null, folios: ['*'] }; });
}

export function crearReporte(d: NuevoReporte): ReporteDemo {
  const incidente = incidentePorId(d.incidenteId);
  const lugar = d.ubicacion ?? LUGARES_DEMO.find((l) => l.id === d.lugarId);
  if (!incidente || !lugar) throw new ErrorDemo(400, 'datos_invalidos');
  const identidad = d.identidad ?? 'completa';
  if (d.codigoCnie) {
    if (incidente.id !== 'otro') throw new ErrorDemo(400, 'cnie_no_aplica');
    exigirCnie(d.codigoCnie);
    // Mal Uso del servicio (tipo 7) solo lo aplica el operador, al verificar el reporte.
    if (esMalUso(d.codigoCnie)) throw new ErrorDemo(400, 'cnie_solo_operador', 'Ese tipo lo aplica solo el operador del CAD.');
  }
  if (d.codigoCnieOperador) {
    exigirCnie(d.codigoCnieOperador);
    if (esMalUso(d.codigoCnieOperador)) throw new ErrorDemo(400, 'cnie_solo_recatalogar', 'Mal Uso del servicio se aplica después de verificar el reporte, con «Recatalogar».');
  }
  const respuestasDadas = respuestasDe(resolverEntradas(PROTOCOLO, incidente.id, d.respuestas, 'formulario').validas);
  if (identidad === 'anonimo' && !permiteAnonimo(incidente.id, respuestasDadas, d.codigoCnie)) throw new ErrorDemo(400, 'anonimo_no_permitido');
  if (identidad === 'seudonimo' && !d.alias?.trim()) throw new ErrorDemo(400, 'falta_seudonimo');
  const cnie = d.codigoCnieOperador ? clasificacionDe(d.codigoCnieOperador, 'operador') : clasificarCnie(incidente.id, respuestasDadas, d.codigoCnie);
  return cambiar((e) => {
    // Anónimo: por el 089 al CQ CIAS. Sin CAD conectado o sin capacidad, también al CQ CIAS.
    const ruta = enrutarPorUbicacion(lugar.lat, lugar.lng, (cadId) => cadConectado(e, cadId), undefined, { capacidad: (cadId) => capacidad(e, cadId), anonimo: identidad === 'anonimo' });
    const notaRuta = textoRespaldo(ruta);
    const iso = ahoraIso();
    const anio = new Date(iso).getUTCFullYear();
    // El folio lleva la parte municipal (014); municipioClave, la clave INEGI completa (22014).
    const claveFolio = ruta.municipio?.claveFolio ?? null;
    const clave = ruta.municipio?.clave ?? null;
    const k = `${claveFolio ?? '000'}-${anio}`;
    e.consecutivos[k] = (e.consecutivos[k] ?? 0) + 1;
    const folio = generarFolio(claveFolio, anio, e.consecutivos[k]);
    const { validas } = resolverEntradas(PROTOCOLO, incidente.id, d.respuestas, 'formulario', iso);
    const canalizada = canalizar(PROTOCOLO, incidente, respuestasDe(validas), { asistenciaDirecta: d.asistenciaDirecta });
    const canalizacion = d.prioridad ? { ...canalizada, prioridad: d.prioridad } : canalizada;
    const por911 = d.origen === '911';
    const notaAlta = por911 ? `Alta por llamada al 911 (${d.tipoTelefono === 'fijo' ? 'teléfono fijo' : 'celular'}), capturada por ${d.altaPor ?? OPERADOR_DEMO.nombre}` : null;
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
      // Anónimo (089): el folio no guarda nombre ni teléfono.
      ciudadano: identidad === 'anonimo' ? { nombre: 'Anónimo', telefono: '', confiabilidad: 1 } : { nombre: d.nombre.trim() || 'Ciudadano de prueba', telefono: d.telefono, confiabilidad: 1 },
      identidad,
      alias: identidad === 'seudonimo' ? d.alias!.trim() : null,
      cuestionario: { protocoloVersion: PROTOCOLO.version, protocoloEstado: PROTOCOLO.estado, entradas: validas },
      canalizacion,
      unidad: null,
      evidencias: (d.fotos ?? []).map((f) => ({ ...f, id: id() })),
      mensajes: [],
      historial: [{ estado: 'recibido', en: iso, ...((notaAlta || notaRuta) && { nota: [notaAlta, notaRuta].filter(Boolean).join('. ') }) }],
      ruta: rutaDe(ruta),
      origen: d.origen ?? 'app',
      tipoTelefono: por911 ? d.tipoTelefono ?? null : null,
      altaPor: por911 ? d.altaPor ?? OPERADOR_DEMO.usuario : null,
      opinion: null,
      creadoEn: iso,
      actualizadoEn: iso,
      // Un municipio dado de alta en Modo A (su propio CAD) lo despacha el CAD simulado de la demo.
      cadSimulado: d.cadSimulado || !operaEnConsola(e, ruta.cadId) ? { inicio: virtual(e.reloj), paso: 0 } : null,
    };
    e.reportes.push(r);
    if (identidad !== 'anonimo') registrar(e, r.ciudadano.nombre, r.ciudadano.telefono, d.origen ?? 'app');
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
export const NOMBRE_RESPALDO = NOMBRE_RESPALDO_ESTATAL;
export { TEXTO_ANONIMA_089, TEXTO_RESPALDO } from '@pol-iaq/shared/movil';
export const nombreCad = (cadId: string) => CADS_DEMO.find((c) => c.id === cadId)?.nombre ?? cadId;
export const tiemposDe = (r: Pick<ReporteDemo, 'historial' | 'prioridad'>) => medirTiempos(r.historial, r.prioridad, ahora());

// ---------------------------------------------------------------------------
// Unidades: GPS (AVL) y asignación por cercanía
// ---------------------------------------------------------------------------

const activos = (e: Estado) => e.reportes.filter((r) => !ESTADOS_FINALES.includes(r.estado));


/**
 * ¿El CAD recibe reportes? Como el API fuera de producción: el C5 siempre, los pilotos salvo
 * suspendidos, y los demás municipios cuando tienen alta (en pruebas o activa).
 */
export function cadConectado(e: Estado, cadId: string): boolean {
  if (cadId === CAD_ESTATAL_ID) return true;
  const r = e.registros?.[cadId];
  if (r?.estado === 'suspendido') return false;
  if (municipioPorCad(cadId)?.piloto) return true;
  return !!r;
}

/** En la demo todo CAD conectado despacha desde la consola, salvo el que se dio de alta en Modo A. */
const operaEnConsola = (e: Estado, cadId: string) => e.registros?.[cadId]?.modo !== 'webhook';

/**
 * ¿El municipio puede contestar? Como el API: null = sí; si no, el motivo. En consola, sin unidades en
 * servicio; en cualquier modo, marcado «sin operador disponible».
 */
function capacidad(e: Estado, cadId: string): string | null {
  if (cadId === CAD_ESTATAL_ID) return null;
  const motivos: string[] = [];
  if (operaEnConsola(e, cadId) && !unidadesActivas(e).some((u) => u.cadId === cadId)) motivos.push('sin unidades en servicio');
  if (e.sinOperador?.[cadId]) motivos.push('sin operador disponible');
  return motivos.length ? motivos.join(' y ') : null;
}

interface UnidadDemo { unidadId: string; cadId: string; corporacion: string; etiqueta: string; tipo: TipoUnidad; base: { lat: number; lng: number }; activa: boolean; origen: 'configuracion' | 'registro' }

function unidadesTodas(e: Estado): UnidadDemo[] {
  const reg = e.unidadesRegistradas ?? [];
  const ids = new Set(reg.map((u) => u.unidadId));
  return [
    ...UNIDADES_DEMO.filter((u) => !ids.has(u.unidadId)).map((u) => ({ ...u, tipo: tipoUnidadDe(u), activa: true, origen: 'configuracion' as const })),
    ...reg.map((u) => ({ ...u, origen: 'registro' as const })),
  ];
}
const unidadesActivas = (e: Estado) => unidadesTodas(e).filter((u) => u.activa);

function unidadesAvl(e: Estado, cadId: string): UnidadAvl[] {
  const ocupadas = new Set(activos(e).filter((r) => r.unidad).map((r) => r.unidad!.unidadId));
  return unidadesActivas(e).filter((u) => puedeDespachar(cadId, u.cadId)).map((u) => ({
    unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, disponible: !ocupadas.has(u.unidadId), posicion: e.avl[u.unidadId],
  }));
}

function asignar(e: Estado, r: ReporteDemo, unidadId: string) {
  const u = unidadesActivas(e).find((x) => x.unidadId === unidadId && puedeDespachar(r.cadId, x.cadId));
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
  | { accion: 'reclasificar'; codigoCnie: string; codigoCnieSecundario?: string | null; motivo?: string }
  | { accion: 'recatalogar_mal_uso'; codigoCnie: string; motivo: string };

/** Acciones que no son despacho: se pueden hacer con el folio cerrado y no quitan la demo automática. */
const SOLO_CLASIFICACION = new Set(['reclasificar', 'recatalogar_mal_uso']);
export const umbralesDe = (e: Estado = leer()) => e.umbrales ?? UMBRALES_SEMAFORO_PREDETERMINADOS;

function yo() {
  const e = leer();
  return {
    operador: { usuario: OPERADOR_DEMO.usuario, nombre: OPERADOR_DEMO.nombre, cads: ['*'] },
    // En la demo los CAD conectados despachan desde la consola (salvo un alta en Modo A).
    cads: CADS_DEMO.map((c) => ({ ...c, modo: operaEnConsola(e, c.id) ? 'consola' as const : 'webhook' as const, mio: true, conectado: cadConectado(e, c.id), estado: e.registros?.[c.id]?.estado ?? (cadConectado(e, c.id) ? 'activo' as const : null), sinCapacidad: cadConectado(e, c.id) ? capacidad(e, c.id) : null, sinOperador: !!e.sinOperador?.[c.id] })),
    protocolo: { version: PROTOCOLO.version, estado: PROTOCOLO.estado },
    semaforo: umbralesDe(e),
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
    municipioClave: claveCompleta(r.municipioClave),
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
    ruta: r.ruta ?? { cadOrigen: r.cadId, motivo: null, canal: '911' as const },
    origen: r.origen ?? 'app',
    tipoTelefono: r.tipoTelefono ?? null,
    altaPor: r.altaPor ?? null,
    respaldo: textoRespaldo(r.ruta),
    operable: operaEnConsola(leer(), r.cadId),
    transiciones: operaEnConsola(leer(), r.cadId) ? ESTADOS.filter((x) => puedeTransicionar(r.estado, x)) : [],
  };
}

export interface Alta911 {
  telefono: string;
  /** Solo si el número no está registrado (o para corregirlo). */
  nombre?: string;
  tipoTelefono: TipoTelefono;
  incidenteId: string;
  descripcion?: string;
  lugarId?: string;
  ubicacion?: { lat: number; lng: number; precisionMetros?: number; referencia?: string };
  respuestas: EntradaCuestionario[];
  prioridad?: Prioridad;
  codigoCnie?: string;
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
      unidades: unidadesTodas(e).map(({ base: _base, ...u }) => ({ ...u, ocupadaEn: ocupadas.get(u.unidadId) ?? null, posicion: u.activa ? e.avl[u.unidadId] ?? null : null })),
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
  /** Paso 1 del alta por 911: ¿el número ya está dado de alta como reportante? */
  reportante(token: string | null, telefono: string) {
    exigirToken(token);
    const tel = telefonoNormal(telefono);
    if (!tel) throw new ErrorDemo(400, 'telefono_invalido', 'Escribe el número de 10 dígitos (puede llevar +52).');
    const r = leer().reportantes?.[tel];
    const folios = leer().reportes.filter((x) => telefonoNormal(x.ciudadano.telefono) === tel && x.identidad !== 'anonimo').length;
    return r ? { telefono: tel, registrado: true as const, reportante: { nombre: r.nombre, registradoEn: r.registradoEn, origen: r.origen, folios } } : { telefono: tel, registrado: false as const, reportante: null };
  },
  /** Alta de un reporte que llegó por teléfono al 911: mismo folio, enrutado e historial que el de la app. */
  alta911(token: string | null, d: Alta911) {
    exigirToken(token);
    const tel = telefonoNormal(d.telefono);
    if (!tel) throw new ErrorDemo(400, 'telefono_invalido', 'Escribe el número de 10 dígitos (puede llevar +52).');
    if (d.tipoTelefono !== 'celular' && d.tipoTelefono !== 'fijo') throw new ErrorDemo(400, 'falta_tipo_telefono', 'Indica si la llamada fue de celular o de teléfono fijo.');
    const previo = leer().reportantes?.[tel];
    const nombre = (d.nombre ?? '').trim() || previo?.nombre || '';
    if (nombre.length < 2) throw new ErrorDemo(400, 'falta_nombre', 'Escribe el nombre de quien llama.');
    const r = crearReporte({
      incidenteId: d.incidenteId, lugarId: d.lugarId, ubicacion: d.ubicacion, descripcion: d.descripcion, respuestas: d.respuestas,
      nombre, telefono: tel, identidad: 'completa', cadSimulado: false, origen: '911', tipoTelefono: d.tipoTelefono, altaPor: OPERADOR_DEMO.nombre,
      ...(d.prioridad && { prioridad: d.prioridad }), ...(d.codigoCnie && { codigoCnieOperador: d.codigoCnie }),
    });
    return { reporte: vistaOperador(r), reportanteNuevo: !previo };
  },
  umbrales(token: string | null) {
    exigirToken(token);
    return umbralesDe();
  },
  fijarUmbrales(token: string | null, u: UmbralesSemaforo) {
    exigirToken(token);
    const error = validarUmbrales(u);
    if (error) throw new ErrorDemo(400, 'umbrales_invalidos', error);
    return cambiar((e) => { e.umbrales = { amarillo: u.amarillo, rojo: u.rojo }; return { resultado: e.umbrales, folios: ['*'] }; });
  },
  accion(token: string | null, folio: string, a: AccionDemo) {
    exigirToken(token);
    return cambiar((e) => {
      const r = delFolio(e, folio);
      if (!operaEnConsola(e, r.cadId)) throw new ErrorDemo(409, 'cad_con_sistema_propio');
      // La clasificación se puede corregir aun cerrado el reporte (sirve a la estadística).
      if (ESTADOS_FINALES.includes(r.estado) && !SOLO_CLASIFICACION.has(a.accion)) throw new ErrorDemo(409, 'reporte_cerrado');
      // Si alguien despacha a mano, el CAD simulado deja de mover ese reporte (corregir el código no cuenta).
      if (!SOLO_CLASIFICACION.has(a.accion)) r.cadSimulado = null;
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
      if (esMalUso(a.codigoCnie)) throw new ErrorDemo(400, 'usar_recatalogar_mal_uso', 'Para Mal Uso del servicio usa «Recatalogar a Mal Uso del servicio», con su motivo.');
      if (a.codigoCnieSecundario) exigirCnie(a.codigoCnieSecundario);
      const antes = r.cnie ?? null;
      const secundario = a.codigoCnieSecundario === null ? null : a.codigoCnieSecundario ?? antes?.secundario?.codigo ?? null;
      r.cnie = clasificacionDe(a.codigoCnie, 'operador', secundario);
      (r.correccionesCnie ??= []).push({ en: ahoraIso(), actor: `operador:${OPERADOR_DEMO.usuario}`, de: codigoDe(antes), a: a.codigoCnie, secundario, motivo: a.motivo?.trim() || null, tipoDe: antes?.tipo.codigo ?? null, tipoA: a.codigoCnie[0] });
      break;
    }
    case 'recatalogar_mal_uso': {
      const motivo = a.motivo?.trim() ?? '';
      if (motivo.length < 3) throw new ErrorDemo(400, 'motivo_obligatorio', 'Escribe el motivo de la recatalogación (por ejemplo, «llamada de broma verificada»).');
      if (motivo.length > 200) throw new ErrorDemo(400, 'motivo_largo', 'El motivo debe ser un texto corto (hasta 200 caracteres).');
      const i = exigirCnie(a.codigoCnie);
      if (!esMalUso(i.codigo)) throw new ErrorDemo(400, 'no_es_mal_uso', 'Elige un incidente del tipo 7, Mal Uso del servicio.');
      const antes = r.cnie ?? null;
      if (antes && esMalUso(antes.tipo.codigo) && antes.incidente?.codigo === i.codigo) throw new ErrorDemo(409, 'ya_recatalogado');
      r.cnie = clasificacionDe(i.codigo, 'operador', null);
      const tipoDe = antes?.tipo.codigo ?? null;
      (r.correccionesCnie ??= []).push({ en: ahoraIso(), actor: `operador:${OPERADOR_DEMO.usuario}`, de: codigoDe(antes), a: i.codigo, secundario: null, motivo, tipoDe, tipoA: i.tipo.codigo, malUso: true });
      // Queda en el historial del folio, sin cambiar su estado: tipo original, tipo nuevo, quién y por qué.
      const original = tipoDe ? `${tipoDe} ${tipoCnie(tipoDe)?.nombre ?? ''} (${codigoDe(antes)})` : 'sin clasificar';
      r.historial.push({ estado: r.estado, en: ahoraIso(), nota: `Recatalogado a Mal Uso del servicio (Improcedentes) por ${autor}: tipo ${original} → ${i.tipo.codigo} ${i.tipo.nombre} (${i.codigo}). Motivo: ${motivo}` });
      break;
    }
    case 'transferir':
      if (a.cadDestinoId === r.cadId || !CADS_DEMO.some((c) => c.id === a.cadDestinoId)) throw new ErrorDemo(400, 'cad_destino_invalido');
      if (!cadConectado(e, a.cadDestinoId)) throw new ErrorDemo(400, 'cad_destino_no_conectado', 'Ese municipio aún no está conectado a POL-IAQ; transfiere al CQ CIAS.');
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
      // Sin acuse a tiempo, el reporte pasa al CQ CIAS con el mismo folio.
      if (!r.cadSimulado && r.estado === 'recibido' && !r.folioCad && r.cadId !== CAD_ESTATAL_ID
        && real - new Date(r.creadoEn).getTime() > ESPERA_ACUSE_SEG * 1000) {
        r.historial.push({ estado: 'recibido', en: ahoraIso(), nota: `${nombreCad(r.cadId)} no acusó en ${ESPERA_ACUSE_SEG} s; se escaló al ${NOMBRE_RESPALDO_ESTATAL}` });
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
    for (const u of unidadesActivas(e)) {
      const p = e.avl[u.unidadId];
      if (!p) { e.avl[u.unidadId] = { ...u.base, en: ahoraIso() }; if (!folios.length) folios.push('*'); continue; }
      if (!ocupadas.has(u.unidadId) && distanciaMetros(p, u.base) > 15) {
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

// ---------------------------------------------------------------------------
// Alta de municipios, unidades, reportes, SESNSP y versión pública
// (lo que hacen /v1/admin, /v1/operador/unidades, /v1/operador/estadistica,
// /v1/operador/sesnsp y /v1/publico)
// ---------------------------------------------------------------------------

export interface AltaDemo {
  cadId: string;
  nombre: string;
  clave: string | null;
  modo: 'webhook' | 'consola';
  webhookUrl?: string;
  secreto?: string;
  certificadoSha256?: string;
  ipsPermitidas?: string[];
  contactoTecnico: { nombre: string; correo: string };
}

function vistaCad(e: Estado, cadId: string) {
  const m = municipioPorCad(cadId);
  const r = e.registros?.[cadId];
  const conectado = cadConectado(e, cadId);
  return {
    cadId,
    nombre: r?.nombre ?? nombreDeCad(cadId),
    clave: m?.clave ?? null,
    claveFolio: m?.claveFolio ?? null,
    municipio: m?.nombre ?? null,
    piloto: m?.piloto ?? false,
    registrado: !!r,
    modo: r?.modo ?? (conectado ? 'consola' : null),
    estado: r?.estado ?? (conectado ? 'activo' : null),
    conectado,
    sinCapacidad: conectado ? capacidad(e, cadId) : null,
    sinOperador: !!e.sinOperador?.[cadId],
    webhookUrl: r?.webhookUrl ?? null,
    tieneSecreto: false,
    certificadoSha256: null,
    ipsPermitidas: [] as string[],
    poligonoPropio: false,
    contactoTecnico: r?.contactoTecnico ?? null,
    casosPrueba: CASOS_PRUEBA_CAD.map((c) => ({ ...c, resultado: r?.casosPrueba[c.id] ?? null })),
    casosPendientes: casosPendientes(r?.casosPrueba as Parameters<typeof casosPendientes>[0]),
    unidades: unidadesActivas(e).filter((u) => u.cadId === cadId).length,
    migracion: null,
    actualizadoEn: r?.actualizadoEn ?? null,
  };
}
export type VistaCad = ReturnType<typeof vistaCad>;

export const admin = {
  cads(token: string | null) {
    exigirToken(token);
    const e = leer();
    return { cads: CAD_IDS.map((id) => vistaCad(e, id)), casos: CASOS_PRUEBA_CAD, ambiente: 'pruebas' as const };
  },
  guardar(token: string | null, datos: AltaDemo) {
    exigirToken(token);
    const p = AltaCadSchema.safeParse({ ...datos, ipsPermitidas: datos.ipsPermitidas ?? [] });
    if (!p.success) throw new ErrorDemo(400, 'alta_invalida', p.error.issues.map((i) => i.message).join('; '));
    // La demo no guarda secretos: solo pide que venga uno en Modo A, como el API.
    if (p.data.modo === 'webhook' && !p.data.secreto) throw new ErrorDemo(400, 'falta_secreto', 'El Modo A (webhook) requiere el secreto HMAC compartido.');
    return cambiar((e) => {
      const previo = e.registros?.[p.data.cadId];
      const yaConectado = !!municipioPorCad(p.data.cadId)?.piloto || p.data.cadId === CAD_ESTATAL_ID;
      if (previo?.modo === 'consola' && p.data.modo === 'webhook' && previo.estado === 'activo') throw new ErrorDemo(409, 'usar_migracion');
      (e.registros ??= {})[p.data.cadId] = {
        cadId: p.data.cadId, nombre: p.data.nombre, clave: p.data.clave, modo: p.data.modo,
        estado: previo?.estado ?? (yaConectado ? 'activo' : 'pruebas'),
        webhookUrl: p.data.modo === 'webhook' ? p.data.webhookUrl ?? null : null,
        contactoTecnico: { nombre: p.data.contactoTecnico.nombre, correo: p.data.contactoTecnico.correo },
        casosPrueba: previo && previo.modo === p.data.modo ? previo.casosPrueba : {},
        actualizadoEn: ahoraIso(),
      };
      return { resultado: vistaCad(e, p.data.cadId), folios: ['*'] };
    });
  },
  estado(token: string | null, cadId: string, estado: 'pruebas' | 'activo' | 'suspendido') {
    exigirToken(token);
    return cambiar((e) => {
      const r = e.registros?.[cadId];
      if (!r) throw new ErrorDemo(404, 'cad_sin_alta');
      if (estado === 'activo') {
        if (r.modo === 'webhook' && casosPendientes(r.casosPrueba as Parameters<typeof casosPendientes>[0]).length) {
          throw new ErrorDemo(409, 'casos_pendientes', 'Faltan los 8 casos de prueba. En el servicio real los corre la suite de certificación contra el ambiente de pruebas.');
        }
        if (r.modo === 'consola' && !unidadesActivas(e).some((u) => u.cadId === cadId)) throw new ErrorDemo(409, 'sin_unidades', 'Registra al menos una unidad antes de activar el despacho desde la consola.');
      }
      r.estado = estado;
      r.actualizadoEn = ahoraIso();
      return { resultado: vistaCad(e, cadId), folios: ['*'] };
    });
  },
};

export interface UnidadNueva { unidadId: string; cadId: string; tipo: TipoUnidad; corporacion: string; etiqueta: string; activa: boolean }

export function guardarUnidad(token: string | null, u: UnidadNueva) {
  exigirToken(token);
  if (!/^[A-Za-z0-9-]{1,30}$/.test(u.unidadId.trim())) throw new ErrorDemo(400, 'datos_invalidos', 'Clave de unidad: letras, números y guiones.');
  if (!TIPOS_UNIDAD.some((t) => t.id === u.tipo) || !CORPORACIONES.some((c) => c.id === u.corporacion)) throw new ErrorDemo(400, 'datos_invalidos');
  if (u.etiqueta.trim().length < 2) throw new ErrorDemo(400, 'datos_invalidos', 'Escribe el nombre de la unidad.');
  if (!CAD_IDS.includes(u.cadId)) throw new ErrorDemo(400, 'cad_desconocido');
  return cambiar((e) => {
    const unidadId = u.unidadId.trim().toUpperCase();
    if (unidadesTodas(e).some((x) => x.unidadId === unidadId && x.cadId !== u.cadId)) throw new ErrorDemo(409, 'unidad_de_otro_cad', `La clave ${unidadId} ya es de otro CAD.`);
    if (!u.activa && activos(e).some((r) => r.unidad?.unidadId === unidadId)) throw new ErrorDemo(409, 'unidad_ocupada');
    const lista = (e.unidadesRegistradas ??= []);
    const previa = lista.find((x) => x.unidadId === unidadId);
    const m = municipioPorCad(u.cadId);
    // Base ficticia dentro de la geocerca del municipio (la posición real llega por GPS).
    const centro = previa?.base ?? (m ? puntoInterior(m.geocerca) : null) ?? { lat: 20.47, lng: -100.2 };
    const n = lista.filter((x) => x.cadId === u.cadId).length;
    const base = previa?.base ?? { lat: +(centro.lat + 0.004 * ((n % 3) - 1)).toFixed(5), lng: +(centro.lng + 0.004 * ((Math.floor(n / 3) % 3) - 1)).toFixed(5) };
    const nueva: UnidadRegistradaDemo = { unidadId, cadId: u.cadId, tipo: u.tipo, corporacion: u.corporacion, etiqueta: u.etiqueta.trim(), activa: u.activa, base, registradaEn: previa?.registradaEn ?? ahoraIso() };
    if (previa) Object.assign(previa, nueva); else lista.push(nueva);
    if (u.activa) e.avl[unidadId] ??= { ...base, en: ahoraIso() };
    return { resultado: { unidad: nueva }, folios: ['*'] };
  });
}

export interface FiltroReportes { cadId?: string; municipio?: string; periodo?: Periodo; fecha?: string }

function filaDe(r: ReporteDemo): FilaEstadistica {
  return {
    folio: r.folio, cadId: r.cadId, municipioClave: claveCompleta(r.municipioClave), creadoEn: r.creadoEn, prioridad: r.prioridad, estado: r.estado,
    cnie: r.cnie ?? null, unidad: r.unidad ? { unidadId: r.unidad.unidadId, etiqueta: r.unidad.etiqueta, corporacion: r.unidad.corporacion } : null,
    tiempos: tiemposDe(r), queja: !!r.opinion?.queja, calificacion: r.opinion?.calificacion ?? null,
    cadOrigen: r.ruta?.cadOrigen ?? r.cadId, respaldo: r.ruta?.motivo ?? null, canal: r.ruta?.canal ?? '911',
  };
}

const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function filasFiltradas(f: FiltroReportes) {
  const rango = f.periodo ? { ...rangoPeriodo(f.periodo, f.fecha || hoyLocal()), periodo: f.periodo } : { desde: undefined, hasta: undefined, etiqueta: 'Todo', periodo: 'todo' as const };
  if (f.municipio && !municipioPorClave(f.municipio)) throw new ErrorDemo(400, 'municipio_desconocido', 'Usa la clave INEGI de 5 dígitos (22001 a 22018).');
  const clave = f.municipio ? claveCompleta(f.municipio) : null;
  const filas = leer().reportes.map(filaDe).filter((x) => (!f.cadId || x.cadId === f.cadId) && (!clave || x.municipioClave === clave) && enRango(x.creadoEn, rango.desde, rango.hasta));
  return { rango, filas };
}

export const reportes = {
  /** Folios del periodo para la tabla dinámica (con lo que el operador ve del reportante). */
  folios(token: string | null, f: FiltroReportes): { filas: FilaFolio[] } {
    exigirToken(token);
    const { filas } = filasFiltradas(f);
    const porFolio = new Map(leer().reportes.map((r) => [r.folio, r]));
    const ahoraMs = Date.now();
    return {
      filas: filas.map((x) => {
        const r = porFolio.get(x.folio)!;
        return filaFolio({ ...x, cnie: r.cnie, unidad: r.unidad, origen: r.origen ?? 'app', ruta: r.ruta, tipoTelefono: r.tipoTelefono ?? null, reportante: reportanteVisible(r, r.ciudadano) }, ahoraMs);
      }),
    };
  },
  estadistica(token: string | null, f: FiltroReportes) {
    exigirToken(token);
    const { rango, filas } = filasFiltradas(f);
    return { periodo: rango, filtros: { cadId: f.cadId ?? null, municipio: f.municipio ?? null }, metas: METAS, ...estadistica(filas) };
  },
  foliosCsv(token: string | null, f: FiltroReportes) {
    exigirToken(token);
    const { rango, filas } = filasFiltradas(f);
    return { nombre: `poliaq-folios-${f.municipio ?? f.cadId ?? 'todos'}-${rango.desde ?? 'inicio'}_${rango.hasta ?? 'hoy'}.csv`, tipo: 'text/csv;charset=utf-8', datos: csvFolios(filas) as string | Uint8Array };
  },
};

function delMes(e: Estado, mes: string) {
  return e.reportes.map(filaDe).filter((f) => mesLocal(f.creadoEn) === mes);
}
function borrador(e: Estado, mes: string) {
  const cierres = e.cierres ?? [];
  const porFolio = new Map(e.reportes.map((r) => [r.folio, r]));
  return cerrarMes(mes, delMes(e, mes), cierres, (f) => { const r = porFolio.get(f); return r && filaDe(r); }, OPERADOR_DEMO.usuario);
}
const sinFoto = ({ foto: _f, ...c }: CierreMensual) => c;

export const sesnsp = {
  lista(token: string | null) {
    exigirToken(token);
    const cierres = leer().cierres ?? [];
    return {
      mesActual: mesLocal(new Date().toISOString()),
      cierres: cierres.map((c) => ({ mes: c.mes, cerradoEn: c.cerradoEn, cerradoPor: c.cerradoPor, filas: c.filas.length, total: c.filas.reduce((n, f) => n + f.total, 0), ajustes: c.ajustes.length, prueba: !!c.prueba })),
      /** Solo en la demo: se puede cerrar el mes en curso para probar el corte (en producción, solo meses terminados). */
      cierreDePrueba: true,
      nota: 'Columnas según lo pedido por POL-IAQ; el formato oficial del CNI/SESNSP está por confirmar con el CQ CIAS.',
    };
  },
  mes(token: string | null, mes: string) {
    exigirToken(token);
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErrorDemo(400, 'mes_invalido');
    const e = leer();
    const c = (e.cierres ?? []).find((x) => x.mes === mes);
    if (c) return { estado: 'cerrado' as const, ...sinFoto(c) };
    return { estado: 'borrador' as const, ...sinFoto(borrador(e, mes)), cerradoEn: null as string | null, cerradoPor: null as string | null };
  },
  /**
   * Cierra un mes terminado. `prueba` (solo en la demo) permite cerrar el mes en curso para probar el
   * corte congelado; queda marcado como cierre de prueba. En producción el API solo cierra meses terminados.
   */
  cerrar(token: string | null, mes: string, prueba = false) {
    exigirToken(token);
    const enCurso = mes >= mesLocal(new Date().toISOString());
    if (enCurso && !prueba) throw new ErrorDemo(409, 'mes_en_curso', 'Solo se cierran meses terminados.');
    if (mes > mesLocal(new Date().toISOString())) throw new ErrorDemo(409, 'mes_en_curso', 'Ese mes aún no empieza.');
    return cambiar((e) => {
      if ((e.cierres ?? []).some((x) => x.mes === mes)) throw new ErrorDemo(409, 'mes_ya_cerrado');
      const c = { ...borrador(e, mes), ...(enCurso && { prueba: true }) };
      (e.cierres ??= []).push(c);
      return { resultado: { estado: 'cerrado' as const, ...sinFoto(c) }, folios: ['*'] };
    });
  },
  archivo(token: string | null, mes: string, archivo: 'reporte.csv' | 'ajustes.csv' | 'reporte.xlsx') {
    exigirToken(token);
    const e = leer();
    const cerrado = (e.cierres ?? []).find((x) => x.mes === mes);
    const c = cerrado ?? borrador(e, mes);
    const suf = cerrado ? '-cerrado' : '-borrador';
    if (archivo === 'reporte.csv') return { nombre: `sesnsp-${mes}${suf}.csv`, tipo: 'text/csv;charset=utf-8', datos: csvSesnsp(c) as string | Uint8Array };
    if (archivo === 'ajustes.csv') return { nombre: `sesnsp-${mes}-ajustes${suf}.csv`, tipo: 'text/csv;charset=utf-8', datos: csvAjustesSesnsp(c) as string | Uint8Array };
    return { nombre: `sesnsp-${mes}${suf}.xlsx`, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', datos: xlsxSesnsp(c) as string | Uint8Array };
  },
};

/**
 * Marca o quita «sin operador disponible» en un CAD municipal. Mientras esté marcado, los reportes
 * nuevos de ese municipio van al CQ CIAS con ese motivo.
 */
export function marcarDisponibilidad(token: string | null, cadId: string, sinOperador: boolean) {
  exigirToken(token);
  if (cadId === CAD_ESTATAL_ID || !CAD_IDS.includes(cadId)) throw new ErrorDemo(400, 'cad_invalido');
  return cambiar((e) => {
    e.sinOperador ??= {};
    if (sinOperador) e.sinOperador[cadId] = { en: ahoraIso(), nota: null }; else delete e.sinOperador[cadId];
    return { resultado: { cadId, sinOperador, sinCapacidad: capacidad(e, cadId) }, folios: ['*'] };
  });
}

/** El actor 19 (Estado): solo su ámbito; clave, tipo y regla de enrutado están pendientes de decisión. */
export const actorEstado = () => ACTOR_ESTADO;

/** Versión pública agregada (sin folios, ubicaciones, unidades ni datos personales). */
export function tiemposPublicos(periodo: Periodo = 'mensual', fecha = hoyLocal()) {
  const rango = rangoPeriodo(periodo, fecha);
  const filas = leer().reportes.map(filaDe).filter((f) => enRango(f.creadoEn, rango.desde, rango.hasta));
  return estadisticaPublica(filas, rango);
}
