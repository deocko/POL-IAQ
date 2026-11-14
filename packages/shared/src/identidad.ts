/**
 * Cómo se identifica el ciudadano en un reporte frente a las autoridades.
 *
 * - `completa`: el operador y el CAD ven nombre y teléfono.
 * - `seudonimo`: ven el seudónimo y el teléfono enmascarado; se comunican por el chat del folio.
 * - `anonimo`: no ven nombre ni teléfono. Solo para incidentes no violentos.
 *
 * En los tres casos la cuenta tiene un teléfono verificado (evita abusos) que
 * Pol-IAQ resguarda; solo se entrega a una autoridad cuando la ley lo exige.
 */
import { z } from 'zod';
import { incidentePorId } from './catalogo';

export const IDENTIDADES = ['completa', 'seudonimo', 'anonimo'] as const;
export type Identidad = (typeof IDENTIDADES)[number];
export const IdentidadSchema = z.enum(IDENTIDADES);

/**
 * Incidentes violentos o en curso contra una persona: requieren que el
 * operador pueda devolver la llamada, así que no admiten reporte anónimo
 * (sí seudónimo).
 */
export const INCIDENTES_SIN_ANONIMATO = ['robo-en-curso', 'agresion', 'intrusion-domicilio', 'violencia-familiar', 'disparos'] as const;

export function permiteAnonimo(incidenteId: string): boolean {
  return !!incidentePorId(incidenteId) && !(INCIDENTES_SIN_ANONIMATO as readonly string[]).includes(incidenteId);
}

export const enmascararTelefono = (t: string) => (t.length >= 4 ? `••••••${t.slice(-4)}` : '••••');

export interface Reportante { nombre: string; telefono: string; confiabilidad: number; identidad: Identidad }

/** Lo que el operador, la unidad y el CAD ven de quien reporta. */
export function reportanteVisible(
  r: { identidad?: Identidad; alias?: string | null },
  ciudadano: { nombre: string; telefono: string; confiabilidad: number },
): Reportante {
  const identidad = r.identidad ?? 'completa';
  if (identidad === 'anonimo') return { nombre: 'Anónimo', telefono: '', confiabilidad: ciudadano.confiabilidad, identidad };
  if (identidad === 'seudonimo') return { nombre: r.alias?.trim() || 'Seudónimo', telefono: enmascararTelefono(ciudadano.telefono), confiabilidad: ciudadano.confiabilidad, identidad };
  return { nombre: ciudadano.nombre, telefono: ciudadano.telefono, confiabilidad: ciudadano.confiabilidad, identidad };
}

/** Calificación de la atención y queja, después del cierre. */
export const OpinionSchema = z.object({
  /** 1 (muy mal) a 5 (muy bien). */
  calificacion: z.number().int().min(1).max(5),
  /** ¿Llegó la unidad? */
  llegoUnidad: z.enum(['si', 'tarde', 'no']),
  comentario: z.string().trim().max(1000).optional(),
});
export type Opinion = z.infer<typeof OpinionSchema>;
export type OpinionGuardada = Opinion & { en: string; queja: boolean };

/** Se trata como queja si no llegó nadie o la calificación es 1 o 2. */
export const esQueja = (o: Opinion) => o.llegoUnidad === 'no' || o.calificacion <= 2;
