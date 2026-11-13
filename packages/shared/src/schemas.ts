import { z } from 'zod';
import { ESTADOS } from './estados';

export const UbicacionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precisionMetros: z.number().nonnegative().optional(),
  referencia: z.string().max(280).optional(),
});
export type Ubicacion = z.infer<typeof UbicacionSchema>;

export const CrearReporteSchema = z.object({
  incidenteId: z.string().min(1),
  ubicacion: UbicacionSchema,
  descripcion: z.string().max(1000).optional(),
  respuestas: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  esPanico: z.boolean().default(false),
  /** Oculta el nombre y teléfono del ciudadano frente a la unidad (el operador sí los ve). */
  ocultarIdentidadAUnidad: z.boolean().default(false),
});
export type CrearReporte = z.infer<typeof CrearReporteSchema>;

export const EvidenciaTipoSchema = z.enum(['foto', 'video', 'audio']);

export const SolicitarEvidenciaSchema = z.object({
  tipo: EvidenciaTipoSchema,
  mimeType: z.string().min(3),
  bytes: z.number().int().positive().max(200 * 1024 * 1024),
  /** SHA-256 calculado en el teléfono, en hexadecimal. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturadoEn: z.iso.datetime(),
  ubicacion: UbicacionSchema.optional(),
});
export type SolicitarEvidencia = z.infer<typeof SolicitarEvidenciaSchema>;

export const MensajeSchema = z.object({ texto: z.string().min(1).max(1000) });

export const EstadoSchema = z.enum(ESTADOS);
