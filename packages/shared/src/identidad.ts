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
import type { ClasificacionCnie } from './cnie';
import { clasificarCnie } from './cnie-mapeo';

export const IDENTIDADES = ['completa', 'seudonimo', 'anonimo'] as const;
export type Identidad = (typeof IDENTIDADES)[number];
export const IdentidadSchema = z.enum(IDENTIDADES);

/**
 * El anónimo se decide por el subtipo del CNIE. En los subtipos violentos o de
 * hechos en curso contra una persona el operador tiene que poder devolver la
 * llamada, así que no admiten anónimo (sí seudónimo).
 */
export const SUBTIPOS_SIN_ANONIMATO = ['302', '304', '305', '309', '310'] as const;
export const SUBTIPOS_CON_ANONIMATO = ['101', '102', '103', '201', '202', '203', '204', '301', '303', '311', '312', '401', '501', '503'] as const;
/**
 * Opciones del catálogo que admiten anónimo aunque su subtipo no lo haga.
 * "Persona o vehículo sospechoso" (30904, subtipo 309) quedó como anónimo en
 * el mapeo aprobado, aunque 309 está en la lista sin anónimo. Se mantiene así
 * hasta que Diego decida (ver docs/cnie/README.md).
 */
export const EXCEPCIONES_ANONIMATO: Record<string, string> = { 'persona-sospechosa': '30904' };

/** Un subtipo que no está en ninguna lista (306, 307, 308, 601, 602, 701) no admite anónimo. */
export const subtipoPermiteAnonimo = (subtipo: string | null | undefined) =>
  !subtipo || (SUBTIPOS_CON_ANONIMATO as readonly string[]).includes(subtipo);

/**
 * ¿Se puede reportar como anónimo? Se revisa el subtipo de la opción elegida y
 * el del código afinado con las respuestas: ambos deben admitirlo.
 * `codigoElegido` es el código que eligió el ciudadano en "Otra emergencia".
 */
export function permiteAnonimo(incidenteId: string, respuestas: Record<string, unknown> = {}, codigoElegido?: string | null): boolean {
  const base = incidentePorId(incidenteId);
  if (!base) return false;
  let final: ClasificacionCnie | null = null;
  try {
    final = clasificarCnie(incidenteId, respuestas, codigoElegido);
  } catch {
    return false;
  }
  const excepcion = EXCEPCIONES_ANONIMATO[incidenteId];
  const ok = (c: { subtipo?: string | null; incidente?: string | null }) =>
    subtipoPermiteAnonimo(c.subtipo) || (!!excepcion && c.incidente === excepcion);
  return ok({ subtipo: base.codigoCnieSubtipo?.codigo, incidente: base.codigoCnie?.codigo })
    && ok({ subtipo: final?.subtipo.codigo, incidente: final?.incidente?.codigo });
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
