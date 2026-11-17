/** Cliente del API de la consola del operador y etiquetas en español. */

import { io } from 'socket.io-client';
import * as demo from '../../lib/demo/motor';
import { horaLocal } from '../../lib/hora';
import type { ClasificacionCnie, Estadistica, FilaSesnsp, AjusteSesnsp, GrupoCnie, MetasTiempo, OpinionGuardada, Periodo, ResumenEtapa, TiemposReporte, TipoUnidad, RutaFolio } from '@pol-iaq/shared/movil';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
/** Demo pública: sin servidor, el API y el CAD simulado corren en el navegador. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export type Prioridad = 'alta' | 'media' | 'baja';
export type Estado = 'recibido' | 'validado' | 'asignado' | 'en_camino' | 'en_sitio' | 'transferido' | 'cerrado' | 'improcedente' | 'cancelado';

export interface Yo {
  operador: { usuario: string; nombre: string; cads: string[] };
  cads: { id: string; nombre: string; clave: string | null; piloto: boolean; modo: 'consola' | 'webhook'; mio: boolean; conectado: boolean; estado: 'pruebas' | 'activo' | 'suspendido' | null; sinCapacidad?: string | null; sinOperador?: boolean }[];
  protocolo: { version: string; estado: 'provisional' | 'vigente' | 'retirado' };
}

export interface Reporte {
  folio: string;
  folioCad: string | null;
  cadId: string;
  /** Clave INEGI de 5 dígitos (22001–22018). */
  municipioClave: string | null;
  incidenteId: string;
  incidente: string;
  categoria: string | null;
  codigoCnie: string | null;
  /** Clasificación CNIE V 3.0; null en folios anteriores o "Otra emergencia" sin clasificar. */
  cnie: ClasificacionCnie | null;
  /** "CNIE 30202 · Seguridad / Armas y explosivos / Detonación por arma de fuego · ALTA". */
  cnieEtiqueta: string | null;
  correccionesCnie: { en: string; actor: string; de: string | null; a: string; secundario: string | null; motivo: string | null }[];
  prioridad: Prioridad;
  estado: Estado;
  asistenciaDirecta: boolean;
  escenarioId: string | null;
  ubicacion: { lat: number; lng: number; precisionMetros?: number; referencia?: string };
  descripcion: string | null;
  reportante: { nombre: string; telefono: string; confiabilidad: number; identidad?: 'completa' | 'seudonimo' | 'anonimo' } | null;
  cuestionario: { protocoloVersion: string; protocoloEstado: string; transcripcion: string; pendientes: string[]; entradas: unknown[] };
  canalizacion: { prioridad: Prioridad; corporaciones: string[]; alertas: string[] };
  recomendaciones: string[];
  unidad: { unidadId: string; corporacion: string; etiqueta: string; etaMinutos?: number; lat?: number; lng?: number; rumbo?: number; distanciaMetros?: number } | null;
  evidencias: { id: string; tipo: string; url: string; sha256: string; expiraEn: string }[];
  mensajes: { id: string; autor: 'ciudadano' | 'operador' | 'unidad'; nombreAutor?: string; texto: string; en: string }[];
  historial: { estado: Estado; en: string; nota?: string }[];
  /** Tiempo de cada etapa contra su meta. */
  tiempos: TiemposReporte;
  /** Calificación o queja del ciudadano después del cierre. */
  opinion: OpinionGuardada | null;
  creadoEn: string;
  actualizadoEn: string;
  escalaAlC5En: string | null;
  /** Cómo se enrutó al crearse: CAD de origen, motivo por el que lo atiende el CQ CIAS y canal (911 / 089). */
  ruta?: RutaFolio;
  /** "Atiende CQ CIAS — municipio sin capacidad (…)", o null si lo atiende el municipio. */
  respaldo?: string | null;
  operable: boolean;
  transiciones: Estado[];
  /** Solo demo: lo despacha la demo automática (el operador puede tomar el control). */
  automatico?: boolean;
  cerradoPorDemo?: boolean;
}

export interface UnidadDisponible {
  unidadId: string;
  cadId: string;
  corporacion: string;
  etiqueta: string;
  tipo: TipoUnidad;
  activa: boolean;
  origen: 'configuracion' | 'registro';
  ocupadaEn: string | null;
  /** Última posición GPS (AVL). */
  posicion: { lat: number; lng: number; rumbo?: number; en: string } | null;
}

export interface Tablero {
  metas: MetasTiempo;
  resumen: ResumenEtapa[];
  reportes: { folio: string; cadId: string; prioridad: Prioridad; estado: Estado; creadoEn: string; cnie: ClasificacionCnie | null; tiempos: TiemposReporte; opinion: OpinionGuardada | null }[];
  quejas: number;
  calificacionPromedio: number | null;
  /** Reportes, quejas y llegada por tipo y subtipo del CNIE. */
  porCnie: { tipos: GrupoCnie[]; subtipos: GrupoCnie[] };
}

export interface VistaCad {
  cadId: string; nombre: string; clave: string | null; claveFolio: string | null; municipio: string | null; piloto: boolean; registrado: boolean;
  modo: 'webhook' | 'consola' | null; estado: 'pruebas' | 'activo' | 'suspendido' | null; conectado: boolean; sinCapacidad: string | null; sinOperador: boolean; webhookUrl: string | null; tieneSecreto: boolean;
  certificadoSha256: string | null; ipsPermitidas: string[]; poligonoPropio: boolean; contactoTecnico: { nombre: string; correo: string } | null;
  casosPrueba: { id: string; nombre: string; resultado: { ok: boolean; en: string; detalle?: string } | null }[]; casosPendientes: string[]; unidades: number;
  migracion: { en: string; por: string; foliosReenviados: number } | null; actualizadoEn: string | null;
}
export interface AltaCad {
  cadId: string; nombre: string; clave: string | null; modo: 'webhook' | 'consola'; webhookUrl?: string; secreto?: string; certificadoSha256?: string; ipsPermitidas?: string[];
  contactoTecnico: { nombre: string; correo: string };
}
export interface UnidadNueva { unidadId: string; cadId: string; tipo: TipoUnidad; corporacion: string; etiqueta: string; activa: boolean }
export interface FiltroReportes { cadId?: string; municipio?: string; periodo?: Periodo; fecha?: string }
export type EstadisticaVista = Estadistica & { periodo: { desde?: string; hasta?: string; etiqueta: string; periodo: string }; metas: MetasTiempo };
export interface ListaSesnsp { mesActual: string; cierres: { mes: string; cerradoEn: string; cerradoPor: string; filas: number; total: number; ajustes: number; prueba?: boolean }[]; nota: string; cierreDePrueba?: boolean }
export interface MesSesnsp { estado: 'cerrado' | 'borrador'; mes: string; cerradoEn: string | null; cerradoPor: string | null; filas: FilaSesnsp[]; ajustes: AjusteSesnsp[]; prueba?: boolean }
export interface Archivo { nombre: string; tipo: string; datos: string | Uint8Array }

export type Accion =
  | { accion: 'recibir' }
  | { accion: 'asignar'; unidadId: string; etaMinutos?: number }
  | { accion: 'asignar_cercana' }
  | { accion: 'estado'; estado: 'en_camino' | 'en_sitio' | 'cerrado' | 'improcedente'; nota?: string }
  | { accion: 'mensaje'; texto: string }
  | { accion: 'transferir'; cadDestinoId: string; motivo?: string }
  | { accion: 'reclasificar'; codigoCnie: string; codigoCnieSecundario?: string | null; motivo?: string };

export class ErrorApi extends Error {
  constructor(readonly status: number, readonly codigo: string, readonly mensaje?: string) {
    super(mensaje ?? codigo);
  }
}

async function llamar<T>(ruta: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...init.headers },
  });
  const cuerpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErrorApi(resp.status, cuerpo.codigo ?? `http_${resp.status}`, cuerpo.mensaje);
  return cuerpo as T;
}

/** Ejecuta la versión en navegador con la misma forma de errores que el API. */
async function enDemo<T>(f: () => unknown): Promise<T> {
  try {
    return f() as T;
  } catch (err) {
    if (err instanceof demo.ErrorDemo) throw new ErrorApi(err.status, err.codigo, err.mensaje);
    throw err;
  }
}

const apiDemo = {
  sesion: (usuario: string, clave: string) => enDemo<Yo & { token: string }>(() => demo.operador.sesion(usuario, clave)),
  yo: (t: string) => enDemo<Yo>(() => demo.operador.yo(t)),
  reportes: (t: string, todos: boolean) => enDemo<{ reportes: Reporte[] }>(() => demo.operador.reportes(t, todos)),
  unidades: (t: string) => enDemo<{ unidades: UnidadDisponible[] }>(() => demo.operador.unidades(t)),
  accion: (t: string, folio: string, a: Accion) => enDemo<Reporte>(() => demo.operador.accion(t, folio, a)),
  tiempos: (t: string) => enDemo<Tablero>(() => demo.operador.tiempos(t)),
  cads: (t: string) => enDemo<{ cads: VistaCad[]; ambiente: string }>(() => demo.admin.cads(t)),
  guardarCad: (t: string, a: AltaCad) => enDemo<VistaCad>(() => demo.admin.guardar(t, a)),
  estadoCad: (t: string, cadId: string, estado: 'pruebas' | 'activo' | 'suspendido') => enDemo<VistaCad>(() => demo.admin.estado(t, cadId, estado)),
  guardarUnidad: (t: string, u: UnidadNueva) => enDemo<{ unidad: unknown }>(() => demo.guardarUnidad(t, u)),
  estadistica: (t: string, f: FiltroReportes) => enDemo<EstadisticaVista>(() => demo.reportes.estadistica(t, f)),
  foliosCsv: (t: string, f: FiltroReportes) => enDemo<Archivo>(() => demo.reportes.foliosCsv(t, f)),
  sesnsp: (t: string) => enDemo<ListaSesnsp>(() => demo.sesnsp.lista(t)),
  sesnspMes: (t: string, mes: string) => enDemo<MesSesnsp>(() => demo.sesnsp.mes(t, mes)),
  cerrarMes: (t: string, mes: string, prueba = false) => enDemo<MesSesnsp>(() => demo.sesnsp.cerrar(t, mes, prueba)),
  disponibilidad: (t: string, cadId: string, sinOperador: boolean) => enDemo<unknown>(() => demo.marcarDisponibilidad(t, cadId, sinOperador)),
  archivoSesnsp: (t: string, mes: string, a: 'reporte.csv' | 'ajustes.csv' | 'reporte.xlsx') => enDemo<Archivo>(() => demo.sesnsp.archivo(t, mes, a)),
};

const consulta = (f: FiltroReportes) => {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return q ? `?${q}` : '';
};

/** Descarga con la sesión del operador (CSV, Excel). */
async function bajar(ruta: string, token: string, nombre: string): Promise<Archivo> {
  const resp = await fetch(`${API}${ruta}`, { headers: { authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const c = await resp.json().catch(() => ({}));
    throw new ErrorApi(resp.status, c.codigo ?? `http_${resp.status}`, c.mensaje);
  }
  const disp = resp.headers.get('content-disposition') ?? '';
  return { nombre: /filename="([^"]+)"/.exec(disp)?.[1] ?? nombre, tipo: resp.headers.get('content-type') ?? 'application/octet-stream', datos: new Uint8Array(await resp.arrayBuffer()) };
}

const apiReal = {
  sesion: (usuario: string, clave: string) => llamar<Yo & { token: string }>('/v1/operador/sesion', null, { method: 'POST', body: JSON.stringify({ usuario, clave }) }),
  yo: (t: string) => llamar<Yo>('/v1/operador/yo', t),
  reportes: (t: string, todos: boolean) => llamar<{ reportes: Reporte[] }>(`/v1/operador/reportes${todos ? '?todos=1' : ''}`, t),
  unidades: (t: string) => llamar<{ unidades: UnidadDisponible[] }>('/v1/operador/unidades', t),
  accion: (t: string, folio: string, a: Accion) => llamar<Reporte>(`/v1/operador/reportes/${encodeURIComponent(folio)}/acciones`, t, { method: 'POST', body: JSON.stringify(a) }),
  tiempos: (t: string) => llamar<Tablero>('/v1/operador/tiempos', t),
  cads: (t: string) => llamar<{ cads: VistaCad[]; ambiente: string }>('/v1/admin/cads', t),
  guardarCad: (t: string, a: AltaCad) => llamar<VistaCad>(`/v1/admin/cads/${a.cadId}`, t, { method: 'PUT', body: JSON.stringify((({ cadId: _c, ...x }) => x)(a)) }),
  estadoCad: (t: string, cadId: string, estado: 'pruebas' | 'activo' | 'suspendido') => llamar<VistaCad>(`/v1/admin/cads/${cadId}/estado`, t, { method: 'POST', body: JSON.stringify({ estado }) }),
  guardarUnidad: (t: string, u: UnidadNueva) => llamar<{ unidad: unknown }>('/v1/operador/unidades', t, { method: 'POST', body: JSON.stringify(u) }),
  estadistica: (t: string, f: FiltroReportes) => llamar<EstadisticaVista>(`/v1/operador/estadistica${consulta(f)}`, t),
  foliosCsv: (t: string, f: FiltroReportes) => bajar(`/v1/operador/estadistica/folios.csv${consulta(f)}`, t, 'poliaq-folios.csv'),
  sesnsp: (t: string) => llamar<ListaSesnsp>('/v1/operador/sesnsp', t),
  sesnspMes: (t: string, mes: string) => llamar<MesSesnsp>(`/v1/operador/sesnsp/${mes}`, t),
  cerrarMes: (t: string, mes: string, _prueba = false) => llamar<MesSesnsp>(`/v1/operador/sesnsp/${mes}/cerrar`, t, { method: 'POST' }),
  disponibilidad: (t: string, cadId: string, sinOperador: boolean) => llamar<unknown>(`/v1/operador/cads/${cadId}/disponibilidad`, t, { method: 'POST', body: JSON.stringify({ sinOperador }) }),
  archivoSesnsp: (t: string, mes: string, a: 'reporte.csv' | 'ajustes.csv' | 'reporte.xlsx') => bajar(`/v1/operador/sesnsp/${mes}/${a}`, t, `sesnsp-${mes}-${a}`),
};

/** Guarda un archivo generado (CSV o Excel) en el equipo del operador. */
export function guardarArchivo(a: Archivo) {
  const blob = new Blob([a.datos as BlobPart], { type: a.tipo });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = a.nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Versión pública (sin sesión). */
export const tiemposPublicos = (periodo: Periodo, fecha: string) =>
  DEMO ? Promise.resolve(demo.tiemposPublicos(periodo, fecha)) : llamar<ReturnType<typeof demo.tiemposPublicos>>(`/v1/publico/tiempos?periodo=${periodo}&fecha=${fecha}`, null);

/** Hora actual: en la demo, el reloj (quizá acelerado) del motor. */
export const ahoraMs = () => (DEMO ? demo.ahora() : Date.now());

export const api = DEMO ? apiDemo : apiReal;

/**
 * Tiempo real. Con API: socket.io en /operacion, cada cambio trae la vista completa.
 * En la demo: aviso entre pestañas del motor del navegador. Devuelve la función para cerrar.
 */
export function conectarOperacion(
  token: string,
  h: { alReporte: (v: Reporte) => void; alEnLinea: (ok: boolean) => void; alRechazo: () => void; alRecargar: () => void },
): () => void {
  if (DEMO) {
    h.alEnLinea(true);
    // Cualquier cambio (de otra pestaña o del CAD simulado) recarga la bandeja completa.
    return demo.escuchar(() => h.alRecargar());
  }
  const s = io(`${API}/operacion`, { transports: ['websocket'] });
  s.on('connect', () => s.emit('suscribir', { token }, (r: { ok: boolean }) => { h.alEnLinea(r.ok); if (!r.ok) h.alRechazo(); }));
  s.on('disconnect', () => h.alEnLinea(false));
  s.on('reporte.actualizado', h.alReporte);
  return () => { s.close(); };
}

export const ESTADO: Record<Estado, string> = {
  recibido: 'Nuevo',
  validado: 'Recibido',
  asignado: 'Unidad asignada',
  en_camino: 'En camino',
  en_sitio: 'En sitio',
  transferido: 'Transferido',
  cerrado: 'Cerrado',
  improcedente: 'Improcedente',
  cancelado: 'Cancelado por el ciudadano',
};

export const CORPORACION: Record<string, string> = {
  policia_municipal: 'Policía municipal',
  policia_estatal: 'Policía estatal',
  cruz_roja: 'Cruz Roja / ambulancia',
  bomberos: 'Bomberos',
  proteccion_civil: 'Protección Civil',
};

export const ERRORES: Record<string, string> = {
  credenciales_invalidas: 'Usuario o clave incorrectos.',
  demasiados_intentos: 'Demasiados intentos. Espera 15 minutos.',
  no_autenticado: 'Tu sesión venció. Vuelve a entrar.',
  cad_con_sistema_propio: 'Este CAD despacha en su propio sistema; aquí solo se consulta.',
  reporte_cerrado: 'El reporte ya está cerrado.',
  ya_recibido: 'Otro operador ya recibió este reporte.',
  transicion_invalida: 'Ese cambio de estado no es válido ahora.',
  unidad_desconocida: 'La unidad no pertenece a este CAD.',
  cad_destino_invalido: 'Elige otro CAD de destino.',
  folio_de_otra_jurisdiccion: 'El reporte cambió de CAD. Actualiza la bandeja.',
  folio_no_encontrado: 'El reporte ya no está en tu bandeja.',
  sin_unidades_disponibles: 'No hay unidades libres con GPS en este CAD. Asigna una a mano o transfiere.',
  cad_destino_no_conectado: 'Ese municipio aún no está conectado a POL-IAQ; transfiere al CQ CIAS.',
  casos_pendientes: 'Faltan casos de prueba aprobados para pasar a producción.',
  sin_unidades: 'Registra al menos una unidad antes de activar el despacho desde la consola.',
  falta_secreto: 'El Modo A requiere el secreto HMAC compartido (mínimo 32 caracteres).',
  usar_migracion: 'Para pasar un municipio activo de la consola a su CAD usa la migración (conserva folios e historial).',
  unidad_de_otro_cad: 'Esa clave de unidad ya es de otro CAD.',
  unidad_ocupada: 'La unidad atiende un reporte; libérala antes de darla de baja.',
  solo_supervision: 'Solo supervisión puede hacer esto.',
  mes_en_curso: 'Solo se cierran meses terminados.',
  mes_ya_cerrado: 'Ese mes ya está cerrado: no se reescribe. Las correcciones salen en el mes siguiente.',
  municipio_desconocido: 'Usa la clave INEGI de 5 dígitos (22001 a 22018).',
};

const PESO: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };
const FINALES: Estado[] = ['cerrado', 'improcedente', 'cancelado'];

/** Bandeja: primero lo activo, luego asistencia directa, prioridad y lo que más lleva esperando. */
export function ordenar(a: Reporte, b: Reporte) {
  return (
    Number(FINALES.includes(a.estado)) - Number(FINALES.includes(b.estado)) ||
    Number(a.estado !== 'recibido') - Number(b.estado !== 'recibido') ||
    Number(b.asistenciaDirecta) - Number(a.asistenciaDirecta) ||
    PESO[a.prioridad] - PESO[b.prioridad] ||
    a.creadoEn.localeCompare(b.creadoEn)
  );
}

export const esFinal = (e: Estado) => FINALES.includes(e);

export function hace(iso: string, ahora: number) {
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export const hora = (iso: string) => horaLocal(iso);

export const distanciaTexto = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export const IDENTIDAD: Record<string, string> = { completa: 'Con su nombre', seudonimo: 'Con seudónimo', anonimo: 'Anónimo' };
export const LLEGO: Record<string, string> = { si: 'Sí llegó', tarde: 'Llegó tarde', no: 'No llegó nadie' };
