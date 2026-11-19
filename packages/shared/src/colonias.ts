/**
 * Colonia del folio. El catálogo es el de SEPOMEX para los 18 municipios de Querétaro (nombre, CP, tipo y zona),
 * cruzado con la clave INEGI del municipio que el folio ya guarda. No hay polígonos de colonia: la colonia se elige
 * por nombre o CP, o se deriva de una mención explícita en el texto de la ubicación («Col. Centro», «C.P. 76000»).
 * Nunca se adivina: si no hay una coincidencia única, el folio queda «Sin colonia».
 *
 * Si una colonia no está en el catálogo, el operador la da de alta a mano con su CP y su ubicación (coordenadas o
 * enlace de Google Maps, o el GPS del dispositivo). Queda marcada «manual» y sin validar hasta su revisión.
 */
import { z } from 'zod';
import { esNumero, soloDigitos } from './busqueda';
import { COLONIAS_QRO_TABLA, TIPOS_ASENTAMIENTO } from './colonias-qro';
import { municipioEn } from './geo';
import { normalizar } from './protocolos';

export { FUENTE_COLONIAS } from './colonias-qro';

export interface ColoniaCatalogo {
  /** Identificador estable: CP + nombre (y tipo si el nombre se repite en el CP). */
  id: string;
  nombre: string;
  tipo: string;
  cp: string;
  /** Clave INEGI de 5 dígitos (22001–22018). */
  municipioClave: string;
  zona: 'Urbano' | 'Rural';
}

let catalogo: ColoniaCatalogo[] | null = null;
let porId: Map<string, ColoniaCatalogo> | null = null;
let buscables: { c: ColoniaCatalogo; n: string }[] | null = null;

/** Catálogo completo (se arma la primera vez que se pide). */
export function coloniasQro(): readonly ColoniaCatalogo[] {
  if (!catalogo) {
    catalogo = COLONIAS_QRO_TABLA.map(([id, cp, nombre, tipo, mun, zona]) => ({ id, cp, nombre, tipo: TIPOS_ASENTAMIENTO[tipo], municipioClave: `22${mun}`, zona: zona === 'U' ? 'Urbano' : 'Rural' }));
  }
  return catalogo;
}

export function coloniaPorId(id: string): ColoniaCatalogo | null {
  porId ??= new Map(coloniasQro().map((c) => [c.id, c]));
  return porId.get(id) ?? null;
}

const enMunicipios = (c: ColoniaCatalogo, municipios?: readonly string[] | null) => !municipios || municipios.includes(c.municipioClave);

/** Colonias de un CP (5 dígitos), opcionalmente solo de ciertos municipios. */
export function coloniasPorCp(cp: string, municipios?: readonly string[] | null): ColoniaCatalogo[] {
  return coloniasQro().filter((c) => c.cp === cp && enMunicipios(c, municipios));
}

/**
 * Búsqueda para el selector de colonia. Con dígitos busca por CP (prefijo de 3 a 5 dígitos); con texto, cada
 * palabra debe estar en el nombre. Primero las que empiezan igual, luego por nombre. `municipios` limita la
 * búsqueda a los municipios que el operador puede ver.
 */
export function buscarColonias(texto: string, opciones: { municipios?: readonly string[] | null; limite?: number } = {}): ColoniaCatalogo[] {
  const limite = opciones.limite ?? 8;
  const t = texto.trim();
  if (!t) return [];
  buscables ??= coloniasQro().map((c) => ({ c, n: normalizar(c.nombre) }));
  const base = buscables.filter((x) => enMunicipios(x.c, opciones.municipios));
  if (esNumero(t)) {
    const d = soloDigitos(t);
    if (d.length < 3) return [];
    return base.filter((x) => x.c.cp.startsWith(d)).map((x) => x.c).sort((a, b) => a.cp.localeCompare(b.cp) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, limite);
  }
  const q = normalizar(t);
  const palabras = q.split(' ').filter(Boolean);
  if (!palabras.length) return [];
  return base
    .filter((x) => palabras.every((p) => x.n.includes(p)))
    .sort((a, b) => Number(!a.n.startsWith(q)) - Number(!b.n.startsWith(q)) || a.n.length - b.n.length || a.c.nombre.localeCompare(b.c.nombre, 'es') || a.c.cp.localeCompare(b.c.cp))
    .slice(0, limite)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Colonia guardada en el folio
// ---------------------------------------------------------------------------

export type FuenteColonia = 'sepomex' | 'manual';

export interface ColoniaFolio {
  /** Id del catálogo SEPOMEX; null en una colonia manual. */
  id: string | null;
  nombre: string;
  cp: string;
  tipo: string | null;
  fuente: FuenteColonia;
  /** Cómo se obtuvo: la eligió el operador o salió de una mención explícita en la ubicación. */
  metodo: 'operador' | 'referencia';
  /** Solo las manuales: ubicación que dio el operador (Google Maps o GPS). */
  lat?: number;
  lng?: number;
  /** Las del catálogo ya están validadas; las manuales quedan pendientes hasta su revisión. */
  validada: boolean;
  asignadaPor: string;
  asignadaEn: string;
}

/** Cambio de colonia hecho por el operador (queda en el historial del folio y en la bitácora). */
export interface CorreccionColonia {
  en: string;
  actor: string;
  de: string | null;
  a: string;
  motivo: string | null;
}

/** Lo que manda la consola: una colonia del catálogo o una manual con CP y ubicación. */
export const ColoniaEntradaSchema = z.union([
  z.object({ coloniaId: z.string().trim().min(3).max(120) }),
  z.object({
    manual: z.object({
      nombre: z.string().trim().min(2, 'Escribe el nombre de la colonia').max(120),
      cp: z.string().trim().regex(/^76\d{3}$/, 'El código postal de Querétaro tiene 5 dígitos y empieza con 76'),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  }),
]);
export type ColoniaEntrada = z.infer<typeof ColoniaEntradaSchema>;

/**
 * Convierte lo que eligió el operador en la colonia del folio. Revisa que la colonia del catálogo sea del municipio
 * del folio y que la ubicación de una manual caiga en ese municipio. Devuelve el motivo si no se puede.
 */
export function resolverColonia(
  entrada: ColoniaEntrada,
  municipioClave: string | null,
  quien: { actor: string; en: string },
): { colonia: ColoniaFolio } | { error: string; mensaje: string } {
  if ('coloniaId' in entrada) {
    const c = coloniaPorId(entrada.coloniaId);
    if (!c) return { error: 'colonia_desconocida', mensaje: 'Esa colonia no está en el catálogo.' };
    if (municipioClave && c.municipioClave !== municipioClave) return { error: 'colonia_otro_municipio', mensaje: `${c.nombre} (CP ${c.cp}) es de otro municipio.` };
    return { colonia: { id: c.id, nombre: c.nombre, cp: c.cp, tipo: c.tipo, fuente: 'sepomex', metodo: 'operador', validada: true, asignadaPor: quien.actor, asignadaEn: quien.en } };
  }
  const m = entrada.manual;
  const donde = municipioEn(m.lat, m.lng);
  if (!donde) return { error: 'ubicacion_fuera', mensaje: 'La ubicación de la colonia queda fuera de Querétaro. Revisa las coordenadas.' };
  if (municipioClave && donde.clave !== municipioClave) return { error: 'colonia_otro_municipio', mensaje: `La ubicación de la colonia cae en ${donde.nombre}, no en el municipio del folio.` };
  const nombre = m.nombre.replace(/\s+/g, ' ').trim();
  const ya = coloniasPorCp(m.cp, municipioClave ? [municipioClave] : null).find((c) => normalizar(c.nombre) === normalizar(nombre));
  if (ya) return resolverColonia({ coloniaId: ya.id }, municipioClave, quien);
  return { colonia: { id: null, nombre, cp: m.cp, tipo: null, fuente: 'manual', metodo: 'operador', lat: m.lat, lng: m.lng, validada: false, asignadaPor: quien.actor, asignadaEn: quien.en } };
}

const RE_CP = /\b(?:c\.?\s*p\.?|codigo postal)\s*:?\s*(76\d{3})\b/;
const RE_NOMBRE = /\b(?:col\.?|colonia|fracc?\.?|fraccionamiento|barrio|bo\.)\s+([^,.;:\n()]+)/;

/**
 * Colonia a partir de una mención explícita en el texto de la ubicación o la descripción: «Col. Centro»,
 * «Fracc. Jurica», «C.P. 76000». Solo si hay una coincidencia única en el municipio del folio; si no, null.
 */
export function coloniaDeTexto(texto: string | null | undefined, municipioClave: string | null): ColoniaCatalogo | null {
  if (!texto || !municipioClave) return null;
  const crudo = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cp = RE_CP.exec(crudo)?.[1] ?? null;
  const nombre = RE_NOMBRE.exec(crudo)?.[1] ? normalizar(RE_NOMBRE.exec(crudo)![1]) : null;
  const delMunicipio = (cs: readonly ColoniaCatalogo[]) => cs.filter((c) => c.municipioClave === municipioClave);
  const candidatas = cp ? coloniasPorCp(cp, [municipioClave]) : nombre ? delMunicipio(coloniasQro()) : [];
  const unica = (cs: ColoniaCatalogo[]) => {
    const nombres = new Set(cs.map((c) => `${c.cp}|${normalizar(c.nombre)}`));
    return nombres.size === 1 ? cs[0] : null;
  };
  if (nombre) {
    const iguales = candidatas.filter((c) => normalizar(c.nombre) === nombre);
    if (iguales.length) return unica(iguales);
    // «Col. Centro Sur, junto al jardín»: el nombre del catálogo es el principio de lo escrito.
    const prefijo = candidatas.filter((c) => nombre.startsWith(`${normalizar(c.nombre)} `));
    if (prefijo.length) return unica(prefijo.filter((c) => normalizar(c.nombre).length === Math.max(...prefijo.map((x) => normalizar(x.nombre).length))));
    return null;
  }
  return cp ? unica(candidatas) : null;
}

/** La colonia derivada del texto, ya en el formato del folio. */
export function coloniaDerivada(c: ColoniaCatalogo, en: string): ColoniaFolio {
  return { id: c.id, nombre: c.nombre, cp: c.cp, tipo: c.tipo, fuente: 'sepomex', metodo: 'referencia', validada: true, asignadaPor: 'sistema:referencia', asignadaEn: en };
}

/** Valor del filtro de colonia: el id del catálogo, `manual:<cp>:<nombre>` o `sin` (sin colonia). */
export const SIN_COLONIA = 'sin';
export function claveColonia(c: Pick<ColoniaFolio, 'id' | 'cp' | 'nombre'> | null | undefined): string {
  if (!c) return SIN_COLONIA;
  return c.id ?? `manual:${c.cp}:${normalizar(c.nombre)}`;
}

/** «Centro · CP 76000», con «(manual, por validar)» si aplica. */
export function textoColonia(c: Pick<ColoniaFolio, 'nombre' | 'cp' | 'fuente' | 'validada'> | null | undefined): string {
  if (!c) return 'Sin colonia';
  return `${c.nombre} · CP ${c.cp}${c.fuente === 'manual' && !c.validada ? ' (manual, por validar)' : ''}`;
}

/**
 * Coordenadas pegadas por el operador: «20.5888, -100.3899» o un enlace de Google Maps (…/@20.58,-100.38,17z,
 * …?q=20.58,-100.38 o …!3d20.58!4d-100.38). Devuelve null si no encuentra un par válido.
 */
export function coordenadasDeTexto(texto: string): { lat: number; lng: number } | null {
  const t = texto.trim();
  const pares: RegExp[] = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i, /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/];
  for (const re of pares) {
    const m = re.exec(t);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
