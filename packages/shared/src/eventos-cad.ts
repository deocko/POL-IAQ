import { z } from 'zod';
import { EstadoSchema, UbicacionSchema } from './schemas';

/**
 * Contrato "API Pol-IAQ CAD v1": eventos que viajan entre Pol-IAQ y cada CAD.
 * Ver docs/api/asyncapi.yaml para la especificación formal.
 */
const Base = z.object({
  /** Identificador único del evento; sirve como idempotency key. */
  eventoId: z.uuid(),
  folio: z.string(),
  /** Número de secuencia por folio, creciente; el receptor descarta duplicados y desordenados. */
  secuencia: z.number().int().nonnegative(),
  ocurridoEn: z.iso.datetime(),
});

// ---- Pol-IAQ -> CAD ----
export const IncidenteCreadoSchema = Base.extend({
  tipo: z.literal('incidente.creado'),
  datos: z.object({
    incidenteId: z.string(),
    codigoCnie: z.string().nullable(),
    prioridad: z.enum(['alta', 'media', 'baja']),
    corporacionSugerida: z.string(),
    ubicacion: UbicacionSchema,
    municipioClave: z.string().nullable(),
    descripcion: z.string().optional(),
    respuestas: z.record(z.string(), z.unknown()),
    esPanico: z.boolean(),
    reportante: z.object({ nombre: z.string(), telefono: z.string(), confiabilidad: z.number().min(0).max(1) }),
    evidencias: z.array(z.object({ id: z.string(), tipo: z.string(), url: z.url(), sha256: z.string(), expiraEn: z.iso.datetime() })),
  }),
});

export const IncidenteActualizadoSchema = Base.extend({
  tipo: z.literal('incidente.actualizado'),
  datos: z.object({
    ubicacion: UbicacionSchema.optional(),
    nuevaEvidencia: z.array(z.object({ id: z.string(), tipo: z.string(), url: z.url(), sha256: z.string(), expiraEn: z.iso.datetime() })).optional(),
    mensajeCiudadano: z.string().optional(),
    cancelado: z.boolean().optional(),
  }),
});

// ---- CAD -> Pol-IAQ ----
export const IncidenteRecibidoSchema = Base.extend({
  tipo: z.literal('incidente.recibido'),
  datos: z.object({ folioCad: z.string(), operador: z.string().optional() }),
});
export const UnidadAsignadaSchema = Base.extend({
  tipo: z.literal('unidad.asignada'),
  datos: z.object({ unidadId: z.string(), corporacion: z.string(), etiqueta: z.string(), etaMinutos: z.number().nonnegative().optional() }),
});
export const UnidadPosicionSchema = Base.extend({
  tipo: z.literal('unidad.posicion'),
  datos: z.object({ unidadId: z.string(), lat: z.number(), lng: z.number(), rumbo: z.number().optional(), etaMinutos: z.number().optional() }),
});
export const IncidenteEstadoSchema = Base.extend({
  tipo: z.literal('incidente.estado'),
  datos: z.object({ estado: EstadoSchema, nota: z.string().optional() }),
});
export const IncidenteTransferidoSchema = Base.extend({
  tipo: z.literal('incidente.transferido'),
  datos: z.object({ cadDestinoId: z.string(), corporacionDestino: z.string().optional(), motivo: z.string().optional() }),
});
export const MensajeOperadorSchema = Base.extend({
  tipo: z.literal('mensaje.operador'),
  datos: z.object({ texto: z.string().min(1).max(1000), autor: z.string() }),
});

export const EventoDesdeCadSchema = z.discriminatedUnion('tipo', [
  IncidenteRecibidoSchema,
  UnidadAsignadaSchema,
  UnidadPosicionSchema,
  IncidenteEstadoSchema,
  IncidenteTransferidoSchema,
  MensajeOperadorSchema,
]);
export type EventoDesdeCad = z.infer<typeof EventoDesdeCadSchema>;

export const EventoHaciaCadSchema = z.discriminatedUnion('tipo', [IncidenteCreadoSchema, IncidenteActualizadoSchema]);
export type EventoHaciaCad = z.infer<typeof EventoHaciaCadSchema>;
