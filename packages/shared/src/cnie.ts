/**
 * Catálogo Nacional de Incidentes de Emergencia (CNIE) del SESNSP.
 *
 * Los datos vienen de `cnie-v3.ts`, generado desde el PDF oficial (ver
 * docs/cnie/README.md). Aquí están las búsquedas, la validación de códigos y
 * la forma en que una clasificación viaja en el reporte, el CAD y el C5.
 *
 * Estructura del código: tipo (1 dígito), subtipo (3 dígitos, empieza con el
 * tipo) e incidente (5 dígitos, empieza con el subtipo).
 */
import { z } from 'zod';
import { CNIE_V3 } from './cnie-v3';
import { normalizar } from './protocolos';

export type PrioridadCnie = 'ALTA' | 'MEDIA' | 'BAJA';
export interface CodigoNombre { codigo: string; nombre: string }
export interface SubtipoCnie extends CodigoNombre { tipo: string; nombreCorto: string }
export interface IncidenteCnie extends CodigoNombre {
  prioridad: PrioridadCnie;
  tipo: CodigoNombre;
  subtipo: SubtipoCnie;
}

export const CNIE_VERSION = CNIE_V3.version;
export const CNIE_FUENTE = `${CNIE_V3.titulo}, oficial, junio 2024. ${CNIE_V3.emisor}.`;

export const TIPOS_CNIE: readonly CodigoNombre[] = CNIE_V3.tipos.map((t) => ({ codigo: t.codigo, nombre: t.nombre }));
/** Solo los vigentes: el 502 se dio de baja en la V 3.0. */
export const SUBTIPOS_CNIE: readonly SubtipoCnie[] = CNIE_V3.subtipos
  .filter((s) => s.vigente)
  .map((s) => ({ codigo: s.codigo, nombre: s.nombre, nombreCorto: s.nombreCorto, tipo: s.codigo[0] }));

const TIPO = new Map(TIPOS_CNIE.map((t) => [t.codigo, t]));
const SUBTIPO = new Map(SUBTIPOS_CNIE.map((s) => [s.codigo, s]));

export const INCIDENTES_CNIE: readonly IncidenteCnie[] = CNIE_V3.incidentes.map(([codigo, nombre, prioridad]) => ({
  codigo,
  nombre,
  prioridad,
  tipo: TIPO.get(codigo[0])!,
  subtipo: SUBTIPO.get(codigo.slice(0, 3))!,
}));
const INCIDENTE = new Map(INCIDENTES_CNIE.map((i) => [i.codigo, i]));

export interface CodigoRetirado { codigo: string; motivo: string; reemplazo: string | null }
export const CODIGOS_CNIE_RETIRADOS: readonly CodigoRetirado[] = CNIE_V3.retirados.map((r) => ({ ...r }));
const RETIRADO = new Map(CODIGOS_CNIE_RETIRADOS.map((r) => [r.codigo, r]));

export const tipoCnie = (codigo: string) => TIPO.get(codigo);
export const subtipoCnie = (codigo: string) => SUBTIPO.get(codigo);
export const incidenteCnie = (codigo: string) => INCIDENTE.get(codigo);
export const subtiposDeTipo = (tipo: string) => SUBTIPOS_CNIE.filter((s) => s.tipo === tipo);
export const incidentesDeSubtipo = (subtipo: string) => INCIDENTES_CNIE.filter((i) => i.subtipo.codigo === subtipo);

export type ErrorCodigoCnie = 'formato' | 'inexistente' | 'retirado';
export type ValidacionCnie =
  | { ok: true; incidente: IncidenteCnie }
  | { ok: false; error: ErrorCodigoCnie; mensaje: string; reemplazo?: string };

/** Solo se aceptan incidentes vigentes del CNIE V 3.0 (5 dígitos). */
export function validarCodigoCnie(codigo: string): ValidacionCnie {
  if (!/^\d{5}$/.test(codigo)) {
    return { ok: false, error: 'formato', mensaje: `"${codigo}" no es un código de incidente CNIE: debe tener 5 dígitos.` };
  }
  const i = INCIDENTE.get(codigo);
  if (i) return { ok: true, incidente: i };
  const r = RETIRADO.get(codigo);
  if (r) {
    return {
      ok: false,
      error: 'retirado',
      mensaje: `El código CNIE ${codigo} ya no está vigente en el CNIE V ${CNIE_VERSION}${r.reemplazo ? `; ahora es ${r.reemplazo} (${INCIDENTE.get(r.reemplazo)?.nombre})` : ''}.`,
      ...(r.reemplazo && { reemplazo: r.reemplazo }),
    };
  }
  return { ok: false, error: 'inexistente', mensaje: `El código CNIE ${codigo} no existe en el CNIE V ${CNIE_VERSION}.` };
}

/** "DETONACIÓN POR ARMA DE FUEGO" → "Detonación por arma de fuego". */
export function nombreLegible(nombre: string): string {
  const s = nombre.toLocaleLowerCase('es-MX');
  return s.charAt(0).toLocaleUpperCase('es-MX') + s.slice(1);
}

/**
 * Busca por código (o su inicio: "304" da todo el subtipo) o por palabras del
 * nombre del incidente, del subtipo o del tipo, sin importar acentos.
 */
export function buscarCnie(texto: string, limite = 30): IncidenteCnie[] {
  const t = texto.trim();
  if (!t) return [];
  if (/^\d{1,5}$/.test(t)) return INCIDENTES_CNIE.filter((i) => i.codigo.startsWith(t)).slice(0, limite);
  const palabras = normalizar(t).split(' ').filter(Boolean);
  const puntos = (i: IncidenteCnie) => {
    const nombre = normalizar(i.nombre);
    const contexto = normalizar(`${i.subtipo.nombre} ${i.subtipo.nombreCorto} ${i.tipo.nombre}`);
    let n = 0;
    for (const p of palabras) {
      if (nombre.split(' ').some((w) => w.startsWith(p))) n += 2;
      else if (contexto.split(' ').some((w) => w.startsWith(p))) n += 1;
      else return 0;
    }
    return n;
  };
  return INCIDENTES_CNIE.map((i) => ({ i, n: puntos(i) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i.codigo.localeCompare(b.i.codigo))
    .slice(0, limite)
    .map((x) => x.i);
}

// ---------------------------------------------------------------------------
// Clasificación de un reporte
// ---------------------------------------------------------------------------

/**
 * De dónde salió el código:
 * - `catalogo`: el código fijo de la opción que eligió el ciudadano.
 * - `respuestas`: se afinó con lo que contestó (despachadora virtual o formulario).
 * - `ciudadano`: lo eligió el ciudadano en "Otra emergencia", navegando el catálogo.
 * - `operador`: lo corrigió el operador (queda en la bitácora).
 */
export const ORIGENES_CNIE = ['catalogo', 'respuestas', 'ciudadano', 'operador'] as const;
export type OrigenCnie = (typeof ORIGENES_CNIE)[number];

const CodigoNombreSchema = z.object({ codigo: z.string(), nombre: z.string() });
export const ClasificacionCnieSchema = z.object({
  version: z.string(),
  tipo: CodigoNombreSchema,
  subtipo: CodigoNombreSchema,
  /** `null` mientras falte afinar el incidente (por ejemplo, "robo" sin saber de qué). */
  incidente: CodigoNombreSchema.nullable(),
  prioridad: z.enum(['ALTA', 'MEDIA', 'BAJA']).nullable(),
  secundario: CodigoNombreSchema.nullable(),
  origen: z.enum(ORIGENES_CNIE),
});
export type ClasificacionCnie = z.infer<typeof ClasificacionCnieSchema>;

const cn = (x: CodigoNombre): CodigoNombre => ({ codigo: x.codigo, nombre: x.nombre });

/** Clasificación completa a partir de un código de incidente vigente. Lanza si no es vigente. */
export function clasificacionDe(codigo: string, origen: OrigenCnie, secundario?: string | null): ClasificacionCnie {
  const i = INCIDENTE.get(codigo);
  if (!i) {
    const v = validarCodigoCnie(codigo);
    throw new Error(v.ok ? codigo : v.mensaje);
  }
  const s = secundario ? INCIDENTE.get(secundario) : undefined;
  if (secundario && !s) throw new Error(`Código secundario no vigente: ${secundario}`);
  return { version: CNIE_VERSION, tipo: cn(i.tipo), subtipo: cn(i.subtipo), incidente: cn(i), prioridad: i.prioridad, secundario: s ? cn(s) : null, origen };
}

/** Solo tipo y subtipo: el incidente se afina después. */
export function clasificacionDeSubtipo(subtipo: string, origen: OrigenCnie, secundario?: string | null): ClasificacionCnie {
  const s = SUBTIPO.get(subtipo);
  if (!s) throw new Error(`Subtipo CNIE no vigente: ${subtipo}`);
  const sec = secundario ? INCIDENTE.get(secundario) : undefined;
  return { version: CNIE_VERSION, tipo: cn(TIPO.get(s.tipo)!), subtipo: cn(s), incidente: null, prioridad: null, secundario: sec ? cn(sec) : null, origen };
}

/**
 * Para la consola y el expediente:
 * "CNIE 30202 · Seguridad / Armas y explosivos / Detonación por arma de fuego · ALTA".
 */
export function etiquetaCnie(c: Pick<ClasificacionCnie, 'tipo' | 'subtipo' | 'incidente' | 'prioridad'>): string {
  const corto = SUBTIPO.get(c.subtipo.codigo)?.nombreCorto ?? c.subtipo.nombre;
  const codigo = c.incidente?.codigo ?? c.subtipo.codigo;
  const partes = [c.tipo.nombre, corto, ...(c.incidente ? [nombreLegible(c.incidente.nombre)] : ['incidente por definir'])];
  return `CNIE ${codigo} · ${partes.join(' / ')}${c.prioridad ? ` · ${c.prioridad}` : ''}`;
}
