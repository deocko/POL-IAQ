import type { ClasificacionCnie, Identidad, OpinionGuardada } from '@pol-iaq/shared';
import type { CasoPruebaCad, ContactoTecnico, EstadoCad, ModoCad, ResultadoCaso, TipoUnidad } from '@pol-iaq/shared';
import type { Canalizacion, Corporacion, Cuestionario, EstadoIncidente, EventoHaciaCad, Prioridad, Ubicacion } from '@pol-iaq/shared';

export interface Ciudadano {
  id: string;
  telefono: string;
  nombre: string;
  /** 0 a 1. Baja con reportes improcedentes; el operador la ve. */
  confiabilidad: number;
  avisoPrivacidadVersion: string;
  terminosVersion: string;
  aceptadoEn: string;
  suspendido: boolean;
}

export interface Evidencia {
  id: string;
  tipo: 'foto' | 'video' | 'audio';
  mimeType: string;
  bytes: number;
  sha256Declarado: string;
  sha256Servidor?: string;
  estado: 'pendiente' | 'verificada' | 'rechazada';
  capturadoEn: string;
  recibidoEn?: string;
  ubicacion?: Ubicacion;
}

export interface Mensaje {
  id: string;
  autor: 'ciudadano' | 'operador' | 'unidad';
  nombreAutor?: string;
  texto: string;
  en: string;
}

export interface Unidad {
  unidadId: string;
  corporacion: string;
  etiqueta: string;
  etaMinutos?: number;
  lat?: number;
  lng?: number;
  rumbo?: number;
  actualizadoEn?: string;
}

export interface Reporte {
  folio: string;
  ciudadanoId: string;
  incidenteId: string;
  /** Incidente CNIE de 5 dígitos (igual a `cnie.incidente.codigo`); `null` mientras falte afinarlo. */
  codigoCnie: string | null;
  /** Clasificación CNIE V 3.0 completa. Los folios anteriores al CNIE no la tienen. */
  cnie?: ClasificacionCnie | null;
  /** Correcciones del código (también quedan en la bitácora de auditoría como `cnie_corregido`). */
  correccionesCnie?: CorreccionCnie[];
  prioridad: Prioridad;
  corporacionSugerida: Corporacion;
  ubicacion: Ubicacion;
  /** Clave INEGI de 5 dígitos del municipio (22001–22018); null fuera de Querétaro. */
  municipioClave: string | null;
  cadId: string;
  folioCad?: string;
  descripcion?: string;
  respuestas: Record<string, unknown>;
  /** Levantado con el botón de asistencia directa. */
  asistenciaDirecta: boolean;
  escenarioId?: string;
  /** Respuestas al protocolo de atención, en texto y con su versión. */
  cuestionario: Cuestionario;
  canalizacion: Canalizacion;
  ocultarIdentidadAUnidad: boolean;
  /** Cómo se identifica ante el operador y el CAD. */
  identidad: Identidad;
  alias?: string;
  /** Calificación y queja del ciudadano después del cierre. */
  opinion?: OpinionGuardada;
  estado: EstadoIncidente;
  unidad?: Unidad;
  evidencias: Evidencia[];
  mensajes: Mensaje[];
  historial: { estado: EstadoIncidente; en: string; nota?: string }[];
  creadoEn: string;
  actualizadoEn: string;
  /** Secuencia del último evento enviado al CAD. */
  secuenciaSalida: number;
  /** Secuencia del último evento aceptado desde el CAD. */
  secuenciaEntrada: number;
}

export interface CorreccionCnie {
  en: string;
  actor: string;
  de: string | null;
  a: string;
  secundario: string | null;
  motivo: string | null;
}

/** Entrada de bitácora de auditoría: quién hizo qué sobre qué folio. */
export interface Auditoria {
  en: string;
  actor: string;
  accion: string;
  folio?: string;
  detalle?: Record<string, unknown>;
}

/** Código de verificación enviado por SMS (solo se guarda su HMAC). */
export interface Otp {
  id: string;
  telefono: string;
  codigoHash: string;
  expiraEn: string;
  intentos: number;
  usado: boolean;
  creadoEn: string;
}

/** Evento en la bandeja de salida hacia un CAD (patrón outbox). */
export interface Envio {
  cadId: string;
  evento: EventoHaciaCad;
  intentos: number;
  /** `consola`: el CAD despacha desde la consola web de POL-IAQ y no recibe webhook. */
  estado: 'pendiente' | 'entregado' | 'fallido' | 'sin_configuracion' | 'consola';
}

/**
 * Alta de un CAD municipal (o del C5) en POL-IAQ. El secreto se guarda cifrado (AES-256-GCM)
 * y nunca se devuelve. Ver docs/interconexion/ALTA-MUNICIPIO.md.
 */
export interface RegistroCad {
  cadId: string;
  nombre: string;
  /** Clave INEGI de 5 dígitos; null para el C5. */
  clave: string | null;
  modo: ModoCad;
  estado: EstadoCad;
  /** Polígono de jurisdicción propio; sin él se usa el de INEGI 2022. */
  poligono?: [number, number][];
  webhookUrl?: string;
  /** `v1:<iv>:<tag>:<cifrado>` en base64. */
  secretoCifrado?: string;
  certificadoSha256?: string;
  ipsPermitidas: string[];
  contactoTecnico: ContactoTecnico;
  casosPrueba: Partial<Record<CasoPruebaCad, ResultadoCaso>>;
  creadoEn: string;
  actualizadoEn: string;
  /** Si pasó de Modo B (consola) a Modo A (webhook), cuándo y cuántos folios se reenviaron. */
  migracion?: { en: string; por: string; foliosReenviados: number };
}

/** Unidad registrada desde la consola (Modo B) o reportada por el CAD (Modo A). */
export interface UnidadRegistrada {
  unidadId: string;
  cadId: string;
  tipo: TipoUnidad;
  corporacion: string;
  etiqueta: string;
  activa: boolean;
  base?: { lat: number; lng: number };
  registradaEn: string;
  registradaPor: string;
}
