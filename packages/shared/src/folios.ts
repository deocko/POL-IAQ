/**
 * Tabla dinámica de folios para los reportes de cada CAD y por municipio: búsqueda por todos los
 * campos (nombre y teléfono incluidos), filtros por columna, orden, paginación y exportación de
 * exactamente lo que se ve filtrado.
 *
 * El nombre y el teléfono son los que el operador ya puede ver en el folio (con identidad completa):
 * de un seudónimo solo el seudónimo y los últimos 4 dígitos; de un anónimo, nada.
 */
import type { ClasificacionCnie, PrioridadCnie } from './cnie';
import { canalOrigen, ETIQUETA_CANAL, ETIQUETA_TIPO_TELEFONO, type CanalOrigen, type OrigenFolio, type TipoTelefono } from './bandeja';
import type { EstadoIncidente } from './estados';
import { CORPORACIONES } from './interconexion';
import { municipioPorClave, nombreDeCad } from './municipios';
import { contiene, palabrasDe } from './busqueda';
import type { TiemposReporte } from './tiempos';
import { csvDeFilas, libroXlsx } from './xlsx';

export interface FilaFolio {
  folio: string;
  creadoEn: string;
  /** AAAA-MM-DD HH:MM en hora de Querétaro. */
  fecha: string;
  municipioClave: string;
  municipio: string;
  /** «Centro» (o vacío sin colonia) y su código postal. */
  colonia: string;
  cp: string;
  /** La colonia la dio de alta un operador y falta validarla. */
  coloniaManual: boolean;
  cadId: string;
  cad: string;
  cnieTipo: string; cnieTipoNombre: string;
  cnieSubtipo: string; cnieSubtipoNombre: string;
  cnieIncidente: string; cnieIncidenteNombre: string;
  estado: EstadoIncidente;
  prioridad: string;
  prioridadCnie: PrioridadCnie | '';
  unidad: string;
  corporacion: string;
  canal: CanalOrigen;
  tipoTelefono: TipoTelefono | '';
  nombre: string;
  telefono: string;
  /** Espera desde la creación hasta la llegada (o hasta ahora) en segundos; null sin medir. */
  demoraSegundos: number | null;
  /** Fracción de la meta de llegada (1 = en el límite). */
  demoraFraccion: number | null;
}

export interface DatosFolio {
  folio: string;
  creadoEn: string;
  municipioClave: string | null;
  cadId: string;
  estado: EstadoIncidente;
  prioridad: string;
  cnie: Pick<ClasificacionCnie, 'tipo' | 'subtipo' | 'incidente' | 'prioridad'> | null | undefined;
  unidad?: { etiqueta: string; corporacion: string } | null;
  origen?: OrigenFolio | null;
  ruta?: { canal?: string } | null;
  tipoTelefono?: TipoTelefono | null;
  /** Lo que el operador ve del reportante (ya filtrado por identidad). */
  reportante: { nombre: string; telefono: string; identidad?: string } | null;
  colonia?: { nombre: string; cp: string; fuente: string; validada: boolean } | null;
  tiempos: TiemposReporte;
}

const ZONA = 'America/Mexico_City';
const fechaHora = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const NOMBRE_CORP = new Map<string, string>(CORPORACIONES.map((c) => [c.id, c.nombre]));

export function filaFolio(d: DatosFolio, ahora: number): FilaFolio {
  const l = d.tiempos.llegada;
  const corriendo = !!l.abierta || l.estado === 'en_curso' || l.estado === 'en_riesgo' || l.estado === 'pendiente';
  const demora = corriendo ? Math.max(0, Math.round((ahora - new Date(d.creadoEn).getTime()) / 1000)) : l.segundos;
  const anonimo = d.reportante?.identidad === 'anonimo';
  const completa = !d.reportante?.identidad || d.reportante.identidad === 'completa';
  return {
    folio: d.folio,
    creadoEn: d.creadoEn,
    fecha: fechaHora(d.creadoEn),
    municipioClave: d.municipioClave ?? '',
    municipio: d.municipioClave ? municipioPorClave(d.municipioClave)?.nombre ?? d.municipioClave : 'Fuera de Querétaro',
    colonia: d.colonia?.nombre ?? '',
    cp: d.colonia?.cp ?? '',
    coloniaManual: d.colonia?.fuente === 'manual' && !d.colonia.validada,
    cadId: d.cadId,
    cad: nombreDeCad(d.cadId),
    cnieTipo: d.cnie?.tipo.codigo ?? '', cnieTipoNombre: d.cnie?.tipo.nombre ?? '',
    cnieSubtipo: d.cnie?.subtipo.codigo ?? '', cnieSubtipoNombre: d.cnie?.subtipo.nombre ?? '',
    cnieIncidente: d.cnie?.incidente?.codigo ?? '', cnieIncidenteNombre: d.cnie?.incidente?.nombre ?? '',
    estado: d.estado,
    prioridad: d.prioridad,
    prioridadCnie: d.cnie?.prioridad ?? '',
    unidad: d.unidad?.etiqueta ?? '',
    corporacion: d.unidad ? NOMBRE_CORP.get(d.unidad.corporacion) ?? d.unidad.corporacion : '',
    canal: canalOrigen(d),
    tipoTelefono: d.tipoTelefono ?? '',
    nombre: anonimo ? '' : d.reportante?.nombre ?? '',
    // Seudónimo: solo los últimos 4 dígitos (lo mismo que ve en el detalle).
    telefono: anonimo || !d.reportante?.telefono ? '' : completa ? d.reportante.telefono : `…${d.reportante.telefono.slice(-4)}`,
    demoraSegundos: demora,
    demoraFraccion: demora == null || !l.metaSegundos ? null : demora / l.metaSegundos,
  };
}

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

export type ColumnaFolio =
  | 'folio' | 'fecha' | 'municipio' | 'colonia' | 'cp' | 'cnieTipo' | 'cnieSubtipo' | 'cnieIncidente' | 'estado' | 'prioridad' | 'prioridadCnie'
  | 'unidad' | 'corporacion' | 'canal' | 'tipoTelefono' | 'nombre' | 'telefono' | 'demora';

/** `opciones`: filtro de lista (valor exacto); sin opciones: filtro de texto (contiene). */
export const COLUMNAS_FOLIO: readonly { id: ColumnaFolio; nombre: string; lista?: boolean }[] = [
  { id: 'folio', nombre: 'Folio' },
  { id: 'fecha', nombre: 'Fecha' },
  { id: 'nombre', nombre: 'Nombre' },
  { id: 'telefono', nombre: 'Teléfono' },
  { id: 'canal', nombre: 'Canal de origen', lista: true },
  { id: 'tipoTelefono', nombre: 'Tipo de teléfono', lista: true },
  { id: 'demora', nombre: 'Demora' },
  { id: 'municipio', nombre: 'Municipio', lista: true },
  { id: 'colonia', nombre: 'Colonia', lista: true },
  { id: 'cp', nombre: 'Código postal' },
  { id: 'cnieTipo', nombre: 'CNIE tipo', lista: true },
  { id: 'cnieSubtipo', nombre: 'CNIE subtipo', lista: true },
  { id: 'cnieIncidente', nombre: 'CNIE incidente' },
  { id: 'estado', nombre: 'Estado', lista: true },
  { id: 'prioridad', nombre: 'Prioridad', lista: true },
  { id: 'prioridadCnie', nombre: 'Prioridad CNIE', lista: true },
  { id: 'unidad', nombre: 'Unidad', lista: true },
  { id: 'corporacion', nombre: 'Corporación', lista: true },
];

/** Texto que se muestra (y se busca) en cada celda. */
export function textoCelda(f: FilaFolio, c: ColumnaFolio): string {
  switch (c) {
    case 'municipio': return f.municipioClave ? `${f.municipioClave} ${f.municipio}` : f.municipio;
    case 'colonia': return f.colonia ? `${f.colonia}${f.coloniaManual ? ' (manual)' : ''}` : 'Sin colonia';
    case 'cnieTipo': return f.cnieTipo ? `${f.cnieTipo} ${f.cnieTipoNombre}` : 'Sin clasificar';
    case 'cnieSubtipo': return f.cnieSubtipo ? `${f.cnieSubtipo} ${f.cnieSubtipoNombre}` : '';
    case 'cnieIncidente': return f.cnieIncidente ? `${f.cnieIncidente} ${f.cnieIncidenteNombre}` : '';
    case 'canal': return ETIQUETA_CANAL[f.canal];
    case 'tipoTelefono': return f.tipoTelefono ? ETIQUETA_TIPO_TELEFONO[f.tipoTelefono] : '';
    case 'demora': return f.demoraSegundos == null ? '' : `${Math.round(f.demoraSegundos / 60)} min`;
    default: return String(f[c] ?? '');
  }
}

export interface ConsultaFolios {
  /** Búsqueda general: cada palabra debe aparecer en algún campo. */
  texto?: string;
  /** Filtro por columna: valor exacto en columnas de lista, «contiene» en las de texto. */
  columnas?: Partial<Record<ColumnaFolio, string>>;
  orden?: { columna: ColumnaFolio; descendente?: boolean };
}

const valorOrden = (f: FilaFolio, c: ColumnaFolio): string | number => {
  if (c === 'fecha') return f.creadoEn;
  if (c === 'demora') return f.demoraFraccion ?? -1;
  if (c === 'prioridad') return ({ alta: 0, media: 1, baja: 2 } as Record<string, number>)[f.prioridad] ?? 3;
  if (c === 'prioridadCnie') return ({ ALTA: 0, MEDIA: 1, BAJA: 2 } as Record<string, number>)[f.prioridadCnie] ?? 3;
  return textoCelda(f, c);
};

/** Aplica búsqueda, filtros por columna y orden. La paginación se hace aparte (`pagina`). */
export function consultarFolios(filas: FilaFolio[], q: ConsultaFolios): FilaFolio[] {
  const palabras = palabrasDe(q.texto);
  const listas = new Set(COLUMNAS_FOLIO.filter((c) => c.lista).map((c) => c.id));
  const filtros = Object.entries(q.columnas ?? {}).filter(([, v]) => v) as [ColumnaFolio, string][];
  const r = filas.filter((f) => {
    for (const [c, v] of filtros) {
      if (listas.has(c) ? textoCelda(f, c) !== v : !contiene(textoCelda(f, c), v)) return false;
    }
    if (!palabras.length) return true;
    const celdas = COLUMNAS_FOLIO.map((c) => textoCelda(f, c.id)).concat(f.cad);
    return palabras.every((p) => celdas.some((c) => contiene(c, p)));
  });
  if (q.orden) {
    const { columna, descendente } = q.orden;
    const s = descendente ? -1 : 1;
    r.sort((a, b) => {
      const x = valorOrden(a, columna);
      const y = valorOrden(b, columna);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')) * s || a.folio.localeCompare(b.folio);
    });
  }
  return r;
}

/** Valores distintos de una columna de lista (para su filtro). */
export const opcionesColumna = (filas: FilaFolio[], c: ColumnaFolio) =>
  [...new Set(filas.map((f) => textoCelda(f, c)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

export function pagina<T>(filas: T[], n: number, porPagina: number) {
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const actual = Math.min(Math.max(1, n), paginas);
  return { filas: filas.slice((actual - 1) * porPagina, actual * porPagina), pagina: actual, paginas, total: filas.length };
}

// ---------------------------------------------------------------------------
// Exportación de lo filtrado
// ---------------------------------------------------------------------------

/**
 * Columnas del archivo. El nombre y el teléfono del reportante no salen en el archivo (pendiente de
 * decisión de Diego): el archivo puede circular fuera de la consola. La tabla sí los muestra.
 */
const EXPORTA: { col: string; v: (f: FilaFolio) => string | number | null }[] = [
  { col: 'folio', v: (f) => f.folio },
  { col: 'fecha_local', v: (f) => f.fecha },
  { col: 'municipio_clave', v: (f) => f.municipioClave },
  { col: 'municipio', v: (f) => f.municipio },
  { col: 'colonia', v: (f) => f.colonia },
  { col: 'codigo_postal', v: (f) => f.cp },
  { col: 'colonia_manual_por_validar', v: (f) => (f.coloniaManual ? 'si' : '') },
  { col: 'cad_responsable', v: (f) => f.cad },
  { col: 'cnie_tipo', v: (f) => f.cnieTipo },
  { col: 'cnie_subtipo', v: (f) => f.cnieSubtipo },
  { col: 'cnie_incidente', v: (f) => f.cnieIncidente },
  { col: 'cnie_nombre', v: (f) => f.cnieIncidenteNombre || f.cnieSubtipoNombre },
  { col: 'estado', v: (f) => f.estado },
  { col: 'prioridad_operativa', v: (f) => f.prioridad },
  { col: 'prioridad_cnie', v: (f) => f.prioridadCnie },
  { col: 'unidad', v: (f) => f.unidad },
  { col: 'corporacion', v: (f) => f.corporacion },
  { col: 'canal_origen', v: (f) => f.canal },
  { col: 'tipo_telefono', v: (f) => f.tipoTelefono },
  { col: 'demora_s', v: (f) => f.demoraSegundos },
];

export const tablaFolios = (filas: FilaFolio[]) => [EXPORTA.map((e) => e.col), ...filas.map((f) => EXPORTA.map((e) => e.v(f)))];
export const csvTablaFolios = (filas: FilaFolio[]) => csvDeFilas(tablaFolios(filas));
export const xlsxTablaFolios = (filas: FilaFolio[], nota: string) =>
  libroXlsx([{ nombre: 'Folios', filas: tablaFolios(filas) }, { nombre: 'Notas', filas: [['nota'], [nota], ['Sin nombre ni teléfono del reportante.']] }]);
