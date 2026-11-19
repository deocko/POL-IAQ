/**
 * Bandeja del operador del CAD: semáforo por demora, grupos de estado, filtros rápidos con su
 * contador y orden por prioridad y demora. Lógica pura: la usan la consola, el API y la demo.
 *
 * Prioridad y demora son dos cosas distintas y las dos se ven en cada fila:
 * - prioridad: la operativa de POL-IAQ (alta / media / baja) y la oficial del CNIE;
 * - demora: el tiempo desde la creación del folio contra su meta de llegada (semáforo).
 */
import { coincideTodo, contiene, esNumero, soloDigitos } from './busqueda';
import type { Prioridad } from './catalogo';
import type { PrioridadCnie } from './cnie';
import { claveColonia, SIN_COLONIA, textoColonia, type ColoniaFolio } from './colonias';
import type { EstadoIncidente } from './estados';
import { municipioPorClave } from './municipios';
import { normalizar } from './protocolos';

// ---------------------------------------------------------------------------
// Semáforo por demora
// ---------------------------------------------------------------------------

export type ColorSemaforo = 'verde' | 'amarillo' | 'rojo';

/**
 * Fracción de la meta de llegada a partir de la cual el folio pasa a amarillo y a rojo.
 * Verde: menos de `amarillo`. Amarillo: de `amarillo` a `rojo`. Rojo: más de `rojo` (fuera de meta).
 */
export interface UmbralesSemaforo { amarillo: number; rojo: number }

/**
 * Valores pedidos en el Mensaje 11 (50 % y 100 % de la meta). Son configurables: en el API con
 * SEMAFORO_AMARILLO y SEMAFORO_ROJO; en la demo, desde la bandeja (supervisión).
 */
export const UMBRALES_SEMAFORO_PREDETERMINADOS: UmbralesSemaforo = { amarillo: 0.5, rojo: 1 };

/** Umbrales válidos: 0 < amarillo < rojo ≤ 10. Devuelve el motivo si no lo son. */
export function validarUmbrales(u: UmbralesSemaforo): string | null {
  if (!Number.isFinite(u.amarillo) || !Number.isFinite(u.rojo)) return 'Los umbrales deben ser números.';
  if (u.amarillo <= 0) return 'El umbral amarillo debe ser mayor que 0 %.';
  if (u.rojo <= u.amarillo) return 'El umbral rojo debe ser mayor que el amarillo.';
  if (u.rojo > 10) return 'El umbral rojo no puede pasar de 1000 % de la meta.';
  return null;
}

/** Verde: menos del umbral amarillo. Amarillo: del amarillo al rojo, inclusive. Rojo: más del umbral rojo (fuera de meta). */
export function colorSemaforo(fraccion: number, u: UmbralesSemaforo = UMBRALES_SEMAFORO_PREDETERMINADOS): ColorSemaforo {
  if (fraccion > u.rojo) return 'rojo';
  if (fraccion >= u.amarillo) return 'amarillo';
  return 'verde';
}

export interface Semaforo {
  color: ColorSemaforo;
  /** Segundos de espera que se miden (desde la creación hasta ahora, o hasta la llegada si ya llegó). */
  segundos: number;
  metaSegundos: number;
  /** 0.75 = 75 % de la meta. */
  fraccion: number;
  /** La espera sigue corriendo (la unidad no ha llegado y el folio no terminó). */
  corriendo: boolean;
}

/**
 * Semáforo de un folio. Mientras la llegada está abierta, la espera corre con el reloj desde la
 * creación del folio; cuando la unidad llegó (o el folio terminó), queda fija en lo que se midió.
 */
export function semaforoDe(
  f: { creadoEn: string; tiempos: { llegada: { segundos: number | null; metaSegundos: number; abierta?: true; estado?: string } } },
  ahora: number,
  u: UmbralesSemaforo = UMBRALES_SEMAFORO_PREDETERMINADOS,
): Semaforo {
  const l = f.tiempos.llegada;
  const corriendo = !!l.abierta || l.estado === 'en_curso' || l.estado === 'en_riesgo' || l.estado === 'pendiente';
  const segundos = corriendo ? Math.max(0, Math.round((ahora - new Date(f.creadoEn).getTime()) / 1000)) : l.segundos ?? 0;
  const fraccion = l.metaSegundos > 0 ? segundos / l.metaSegundos : 0;
  return { color: colorSemaforo(fraccion, u), segundos, metaSegundos: l.metaSegundos, fraccion, corriendo };
}

export const ETIQUETA_SEMAFORO: Record<ColorSemaforo, string> = {
  verde: 'Recién llegado',
  amarillo: 'Lleva tiempo',
  rojo: 'Fuera de meta',
};

// ---------------------------------------------------------------------------
// Grupos de estado de la bandeja
// ---------------------------------------------------------------------------

/**
 * - nuevos: aún sin acuse del operador (recibido o recién transferido);
 * - pendientes: en atención (recibido por el operador, con unidad asignada, en camino o en sitio);
 * - atendidos: terminados (cerrados, improcedentes o cancelados).
 */
export type GrupoEstado = 'nuevos' | 'pendientes' | 'atendidos';
export const GRUPOS_ESTADO: readonly { id: GrupoEstado; nombre: string }[] = [
  { id: 'nuevos', nombre: 'Nuevos' },
  { id: 'pendientes', nombre: 'Pendientes' },
  { id: 'atendidos', nombre: 'Atendidos' },
];
export function grupoEstado(e: EstadoIncidente): GrupoEstado {
  if (e === 'recibido' || e === 'transferido') return 'nuevos';
  if (e === 'cerrado' || e === 'improcedente' || e === 'cancelado') return 'atendidos';
  return 'pendientes';
}

// ---------------------------------------------------------------------------
// Origen del folio y tipo de teléfono
// ---------------------------------------------------------------------------

/** Por dónde entró el folio: la app ciudadana o una llamada al 911 capturada en la consola. */
export type OrigenFolio = 'app' | '911';
export type TipoTelefono = 'celular' | 'fijo';
/** Canal que se muestra y se filtra en los reportes: app, 911 (llamada) o anónimo (089). */
export type CanalOrigen = 'app' | '911' | 'anonimo';
export const ETIQUETA_CANAL: Record<CanalOrigen, string> = { app: 'App', '911': 'Llamada 911', anonimo: 'Anónimo (089)' };
export const ETIQUETA_TIPO_TELEFONO: Record<TipoTelefono, string> = { celular: 'Celular', fijo: 'Fijo' };

export function canalOrigen(f: { origen?: OrigenFolio | null; ruta?: { canal?: string } | null }): CanalOrigen {
  if (f.origen === '911') return '911';
  if (f.ruta?.canal === '089') return 'anonimo';
  return 'app';
}

// ---------------------------------------------------------------------------
// Filtros rápidos, contadores y orden
// ---------------------------------------------------------------------------

export interface FilaBandeja {
  folio: string;
  estado: EstadoIncidente;
  prioridad: Prioridad;
  cnie: { prioridad: PrioridadCnie | null; tipo?: { codigo: string; nombre: string }; subtipo?: { codigo: string; nombre: string }; incidente?: { codigo: string; nombre: string } | null } | null;
  municipioClave: string | null;
  creadoEn: string;
  asistenciaDirecta?: boolean;
  tiempos: Parameters<typeof semaforoDe>[0]['tiempos'];
  // Campos para la búsqueda y los filtros de texto (opcionales: la lógica de los filtros rápidos no los usa).
  folioCad?: string | null;
  /** Nombre corto del incidente ("nombre del reporte"). */
  incidente?: string;
  descripcion?: string | null;
  ubicacion?: { referencia?: string };
  /** Lo que el operador ya ve del reportante (el servidor oculta al anónimo y enmascara al seudónimo). */
  reportante?: { nombre: string; telefono: string; identidad?: string } | null;
  colonia?: Pick<ColoniaFolio, 'id' | 'nombre' | 'cp' | 'fuente' | 'validada'> | null;
  unidad?: { etiqueta: string; corporacion?: string } | null;
  origen?: OrigenFolio | null;
  ruta?: { canal?: string } | null;
}

export interface FiltroBandeja {
  estado?: GrupoEstado | null;
  /** Prioridad operativa de POL-IAQ. */
  prioridad?: Prioridad | null;
  /** Prioridad oficial del CNIE. */
  prioridadCnie?: PrioridadCnie | null;
  /** Clave INEGI de 5 dígitos; `000` = fuera de Querétaro. */
  municipio?: string | null;
  /** Tiempo de espera: color del semáforo. */
  demora?: ColorSemaforo | null;
  /** Colonia: id del catálogo, `manual:<cp>:<nombre>` o `sin` (sin colonia). */
  colonia?: string | null;
  /** Tipo CNIE (1 dígito) o `sin` (sin código CNIE). */
  cnieTipo?: string | null;
  /** Por dónde entró: app, llamada 911 o anónimo (089). */
  canal?: CanalOrigen | null;
  /** Búsqueda general: cada palabra debe aparecer en algún campo. */
  texto?: string | null;
  /** Teléfono del reportante (contiene; con espacios, guiones o +52). */
  telefono?: string | null;
  /** Nombre del reportante (contiene). */
  nombre?: string | null;
  /** Código postal de la colonia (contiene). */
  cp?: string | null;
}
/** Filtros de lista (valor exacto) que llevan contador por opción. */
export type CampoFiltro = 'estado' | 'prioridad' | 'prioridadCnie' | 'municipio' | 'demora' | 'colonia' | 'cnieTipo' | 'canal';
/** Filtros de texto (contiene): no llevan contador por opción. */
export type CampoTexto = 'texto' | 'telefono' | 'nombre' | 'cp';
export const CAMPOS_TEXTO: readonly CampoTexto[] = ['texto', 'telefono', 'nombre', 'cp'];

const nombreVisible = (f: FilaBandeja) => (f.reportante?.identidad === 'anonimo' ? '' : f.reportante?.nombre ?? '');

const valor = (f: FilaBandeja, campo: CampoFiltro, ahora: number, u: UmbralesSemaforo): string | null => {
  switch (campo) {
    case 'estado': return grupoEstado(f.estado);
    case 'prioridad': return f.prioridad;
    case 'prioridadCnie': return f.cnie?.prioridad ?? null;
    case 'municipio': return f.municipioClave ?? '000';
    case 'demora': return semaforoDe(f, ahora, u).color;
    case 'colonia': return claveColonia(f.colonia);
    case 'cnieTipo': return f.cnie?.tipo?.codigo ?? SIN_CNIE;
    case 'canal': return canalOrigen(f);
  }
};

/** Valor del filtro de tipo CNIE para los folios sin código. */
export const SIN_CNIE = 'sin';

/** Todo lo que se busca con la barra: lo que el operador ya ve en la fila y en el detalle. */
export function camposBuscables(f: FilaBandeja): string[] {
  const c = f.cnie;
  return [
    f.folio, f.folioCad ?? '', f.incidente ?? '', nombreVisible(f), f.reportante?.telefono ?? '',
    c?.incidente ? `${c.incidente.codigo} ${c.incidente.nombre}` : '', c?.subtipo ? `${c.subtipo.codigo} ${c.subtipo.nombre}` : '', c?.tipo ? `${c.tipo.codigo} ${c.tipo.nombre}` : '',
    f.colonia ? `${f.colonia.nombre} ${f.colonia.cp}` : '', f.municipioClave ? municipioPorClave(f.municipioClave)?.nombre ?? '' : '',
    f.ubicacion?.referencia ?? '', f.descripcion ?? '', f.unidad?.etiqueta ?? '',
  ].filter(Boolean);
}

function pasaTexto(f: FilaBandeja, filtro: FiltroBandeja): boolean {
  if (filtro.texto?.trim() && !coincideTodo(camposBuscables(f), filtro.texto)) return false;
  if (filtro.telefono?.trim() && !contiene(f.reportante?.telefono ?? '', filtro.telefono)) return false;
  if (filtro.nombre?.trim() && !contiene(nombreVisible(f), filtro.nombre)) return false;
  if (filtro.cp?.trim() && !(f.colonia?.cp ?? '').startsWith(soloDigitos(filtro.cp))) return false;
  return true;
}

const CAMPOS: CampoFiltro[] = ['estado', 'prioridad', 'prioridadCnie', 'municipio', 'demora', 'colonia', 'cnieTipo', 'canal'];

/** ¿La fila pasa todos los filtros, salvo (opcional) uno? */
function pasa(f: FilaBandeja, filtro: FiltroBandeja, ahora: number, u: UmbralesSemaforo, excepto?: CampoFiltro) {
  return CAMPOS.every((c) => c === excepto || !filtro[c] || valor(f, c, ahora, u) === filtro[c]) && pasaTexto(f, filtro);
}

/** Cuántos filtros hay aplicados (el estado cuenta solo si no es la vista por defecto). */
export function filtrosAplicados(filtro: FiltroBandeja & { estado?: string | null }, estadoPorDefecto: string | null = null): number {
  let n = 0;
  for (const c of CAMPOS) if (filtro[c] && !(c === 'estado' && filtro.estado === estadoPorDefecto)) n++;
  for (const c of CAMPOS_TEXTO) if (filtro[c]?.trim()) n++;
  return n;
}

/** Colonias presentes en las filas, con su texto («Centro · CP 76000»), para el selector y los chips. */
export function coloniasDeFilas(filas: FilaBandeja[]): { clave: string; texto: string; manual: boolean }[] {
  const m = new Map<string, { clave: string; texto: string; manual: boolean }>();
  for (const f of filas) {
    const clave = claveColonia(f.colonia);
    if (!m.has(clave)) m.set(clave, { clave, texto: textoColonia(f.colonia), manual: f.colonia?.fuente === 'manual' });
  }
  return [...m.values()].sort((a, b) => Number(a.clave === SIN_COLONIA) - Number(b.clave === SIN_COLONIA) || a.texto.localeCompare(b.texto, 'es'));
}

export type Sugerencia =
  | { campo: 'texto' | 'telefono' | 'nombre' | 'cp'; valor: string; etiqueta: string; n: number }
  | { campo: 'colonia'; valor: string; etiqueta: string; n: number };

/**
 * Sugerencias de la barra mientras el operador escribe: buscar en todo, o convertir lo escrito en un filtro
 * (teléfono, nombre, CP o una colonia de las que hay en la bandeja). `n` es cuántos folios deja ver cada una.
 */
export function sugerenciasBusqueda(texto: string, filas: FilaBandeja[], limiteColonias = 4): Sugerencia[] {
  const t = texto.trim();
  if (!t) return [];
  const cuenta = (filtro: FiltroBandeja) => filas.filter((f) => pasaTexto(f, filtro)).length;
  const r: Sugerencia[] = [{ campo: 'texto', valor: t, etiqueta: `Buscar «${t}» en todo`, n: cuenta({ texto: t }) }];
  if (esNumero(t)) {
    const d = soloDigitos(t);
    if (d.length >= 3) r.push({ campo: 'telefono', valor: d, etiqueta: `Teléfono con ${d}`, n: cuenta({ telefono: d }) });
    if (/^76\d{0,3}$/.test(d) && d.length >= 3) r.push({ campo: 'cp', valor: d, etiqueta: `Código postal ${d.length === 5 ? d : `${d}…`}`, n: cuenta({ cp: d }) });
  } else {
    const nN = cuenta({ nombre: t });
    if (nN) r.push({ campo: 'nombre', valor: t, etiqueta: `Nombre de quien reporta: «${t}»`, n: nN });
  }
  const q = normalizar(t);
  const porClave = new Map<string, { texto: string; n: number }>();
  for (const f of filas) {
    if (!f.colonia) continue;
    const ok = esNumero(t) ? f.colonia.cp.startsWith(soloDigitos(t)) : normalizar(f.colonia.nombre).includes(q);
    if (!ok) continue;
    const k = claveColonia(f.colonia);
    const x = porClave.get(k) ?? { texto: textoColonia(f.colonia), n: 0 };
    x.n++;
    porClave.set(k, x);
  }
  [...porClave.entries()].sort((a, b) => b[1].n - a[1].n || a[1].texto.localeCompare(b[1].texto, 'es')).slice(0, limiteColonias)
    .forEach(([k, x]) => r.push({ campo: 'colonia', valor: k, etiqueta: `Colonia ${x.texto}`, n: x.n }));
  return r;
}

export function filtrarBandeja<T extends FilaBandeja>(filas: T[], filtro: FiltroBandeja, ahora: number, u: UmbralesSemaforo = UMBRALES_SEMAFORO_PREDETERMINADOS): T[] {
  return filas.filter((f) => pasa(f, filtro, ahora, u));
}

/**
 * Contador de cada opción de cada filtro, con los demás filtros aplicados (así combinan: al elegir
 * «alta», el contador de «Nuevos» dice cuántos nuevos de prioridad alta hay).
 */
export function contadoresBandeja(filas: FilaBandeja[], filtro: FiltroBandeja, ahora: number, u: UmbralesSemaforo = UMBRALES_SEMAFORO_PREDETERMINADOS): Record<CampoFiltro, Record<string, number>> {
  const r = Object.fromEntries(CAMPOS.map((c) => [c, {} as Record<string, number>])) as Record<CampoFiltro, Record<string, number>>;
  for (const f of filas) {
    for (const c of CAMPOS) {
      if (!pasa(f, filtro, ahora, u, c)) continue;
      const v = valor(f, c, ahora, u);
      if (v == null) continue;
      r[c][v] = (r[c][v] ?? 0) + 1;
      r[c]['*'] = (r[c]['*'] ?? 0) + 1;
    }
  }
  return r;
}

export type OrdenBandeja = 'prioridad_demora' | 'demora' | 'prioridad' | 'recientes';
export const ORDENES_BANDEJA: readonly { id: OrdenBandeja; nombre: string }[] = [
  { id: 'prioridad_demora', nombre: 'Prioridad y demora' },
  { id: 'demora', nombre: 'Demora (más espera primero)' },
  { id: 'prioridad', nombre: 'Prioridad' },
  { id: 'recientes', nombre: 'Más recientes' },
];
const PESO: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };

/**
 * Orden de la bandeja. Por defecto: primero los de mayor prioridad y, dentro de cada prioridad, los
 * que llevan más tiempo esperando respecto a su meta. Los terminados van al final.
 */
export function ordenarBandeja<T extends FilaBandeja>(filas: T[], orden: OrdenBandeja, ahora: number, u: UmbralesSemaforo = UMBRALES_SEMAFORO_PREDETERMINADOS): T[] {
  const fr = new Map(filas.map((f) => [f.folio, semaforoDe(f, ahora, u).fraccion]));
  const fin = (f: T) => Number(grupoEstado(f.estado) === 'atendidos');
  const demora = (a: T, b: T) => fr.get(b.folio)! - fr.get(a.folio)! || a.creadoEn.localeCompare(b.creadoEn);
  const prio = (a: T, b: T) => Number(!!b.asistenciaDirecta) - Number(!!a.asistenciaDirecta) || PESO[a.prioridad] - PESO[b.prioridad];
  const cmp: Record<OrdenBandeja, (a: T, b: T) => number> = {
    prioridad_demora: (a, b) => prio(a, b) || demora(a, b),
    demora: (a, b) => demora(a, b) || prio(a, b),
    prioridad: (a, b) => prio(a, b) || a.creadoEn.localeCompare(b.creadoEn),
    recientes: (a, b) => b.creadoEn.localeCompare(a.creadoEn),
  };
  return [...filas].sort((a, b) => fin(a) - fin(b) || cmp[orden](a, b));
}
