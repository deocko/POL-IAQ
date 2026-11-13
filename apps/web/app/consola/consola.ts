/** Cliente del API de la consola del operador y etiquetas en español. */

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export type Prioridad = 'alta' | 'media' | 'baja';
export type Estado = 'recibido' | 'validado' | 'asignado' | 'en_camino' | 'en_sitio' | 'transferido' | 'cerrado' | 'improcedente' | 'cancelado';

export interface Yo {
  operador: { usuario: string; nombre: string; cads: string[] };
  cads: { id: string; nombre: string; modo: 'consola' | 'webhook'; mio: boolean }[];
  protocolo: { version: string; estado: 'provisional' | 'vigente' | 'retirado' };
}

export interface Reporte {
  folio: string;
  folioCad: string | null;
  cadId: string;
  incidenteId: string;
  incidente: string;
  categoria: string | null;
  codigoCnie: string | null;
  prioridad: Prioridad;
  estado: Estado;
  asistenciaDirecta: boolean;
  escenarioId: string | null;
  ubicacion: { lat: number; lng: number; precisionMetros?: number; referencia?: string };
  descripcion: string | null;
  reportante: { nombre: string; telefono: string; confiabilidad: number } | null;
  cuestionario: { protocoloVersion: string; protocoloEstado: string; transcripcion: string; pendientes: string[]; entradas: unknown[] };
  canalizacion: { prioridad: Prioridad; corporaciones: string[]; alertas: string[] };
  recomendaciones: string[];
  unidad: { unidadId: string; corporacion: string; etiqueta: string; etaMinutos?: number } | null;
  evidencias: { id: string; tipo: string; url: string; sha256: string; expiraEn: string }[];
  mensajes: { id: string; autor: 'ciudadano' | 'operador' | 'unidad'; nombreAutor?: string; texto: string; en: string }[];
  historial: { estado: Estado; en: string; nota?: string }[];
  creadoEn: string;
  actualizadoEn: string;
  escalaAlC5En: string | null;
  operable: boolean;
  transiciones: Estado[];
}

export interface UnidadDisponible {
  unidadId: string;
  cadId: string;
  corporacion: string;
  etiqueta: string;
  ocupadaEn: string | null;
}

export type Accion =
  | { accion: 'recibir' }
  | { accion: 'asignar'; unidadId: string; etaMinutos?: number }
  | { accion: 'estado'; estado: 'en_camino' | 'en_sitio' | 'cerrado' | 'improcedente'; nota?: string }
  | { accion: 'mensaje'; texto: string }
  | { accion: 'transferir'; cadDestinoId: string; motivo?: string };

export class ErrorApi extends Error {
  constructor(readonly status: number, readonly codigo: string) {
    super(codigo);
  }
}

async function llamar<T>(ruta: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...init.headers },
  });
  const cuerpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErrorApi(resp.status, cuerpo.codigo ?? `http_${resp.status}`);
  return cuerpo as T;
}

export const api = {
  sesion: (usuario: string, clave: string) => llamar<Yo & { token: string }>('/v1/operador/sesion', null, { method: 'POST', body: JSON.stringify({ usuario, clave }) }),
  yo: (t: string) => llamar<Yo>('/v1/operador/yo', t),
  reportes: (t: string, todos: boolean) => llamar<{ reportes: Reporte[] }>(`/v1/operador/reportes${todos ? '?todos=1' : ''}`, t),
  unidades: (t: string) => llamar<{ unidades: UnidadDisponible[] }>('/v1/operador/unidades', t),
  accion: (t: string, folio: string, a: Accion) => llamar<Reporte>(`/v1/operador/reportes/${encodeURIComponent(folio)}/acciones`, t, { method: 'POST', body: JSON.stringify(a) }),
};

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

export const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
