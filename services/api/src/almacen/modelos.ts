import type { Corporacion, EstadoIncidente, Prioridad, Ubicacion } from '@pol-iaq/shared';

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
  codigoCnie: string | null;
  prioridad: Prioridad;
  corporacionSugerida: Corporacion;
  ubicacion: Ubicacion;
  municipioClave: string | null;
  cadId: string;
  folioCad?: string;
  descripcion?: string;
  respuestas: Record<string, unknown>;
  esPanico: boolean;
  ocultarIdentidadAUnidad: boolean;
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

/** Entrada de bitácora de auditoría: quién hizo qué sobre qué folio. */
export interface Auditoria {
  en: string;
  actor: string;
  accion: string;
  folio?: string;
  detalle?: Record<string, unknown>;
}
