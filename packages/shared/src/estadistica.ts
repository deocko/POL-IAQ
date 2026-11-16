/**
 * Reportes y estadística por municipio (los mismos datos en Modo A y Modo B).
 *
 * Todo sale de los folios: volumen, tiempos contra meta y quejas, agrupados por municipio, CNIE
 * (tipo, subtipo e incidente, comparable entre municipios y con el C5), corporación y unidad.
 * La versión pública no lleva datos personales y oculta los grupos con pocos reportes.
 */
import type { ClasificacionCnie } from './cnie';
import type { EstadoIncidente } from './estados';
import { CORPORACIONES } from './interconexion';
import { CAD_ESTATAL_ID, municipioPorClave, nombreDeCad } from './municipios';
import { resumirTiempos, type ResumenEtapa, type TiemposReporte } from './tiempos';

export type Periodo = 'diario' | 'semanal' | 'mensual';

/** Lo mínimo de un folio para la estadística (sin datos del reportante). */
export interface FilaEstadistica {
  folio: string;
  cadId: string;
  municipioClave: string | null;
  creadoEn: string;
  prioridad: string;
  estado: EstadoIncidente;
  cnie: Pick<ClasificacionCnie, 'tipo' | 'subtipo' | 'incidente'> | null | undefined;
  unidad?: { unidadId: string; etiqueta: string; corporacion: string } | null;
  tiempos: TiemposReporte;
  queja: boolean;
  calificacion?: number | null;
}

export interface Grupo {
  clave: string;
  nombre: string;
  reportes: number;
  quejas: number;
  /** Desde que se levanta el reporte hasta que llega la unidad. */
  llegada: ResumenEtapa;
}

const ZONA = 'America/Mexico_City';
const fechaLocal = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** Inicio y fin (exclusivo) del periodo que contiene `fecha` (AAAA-MM-DD), en hora de Querétaro. Semana de lunes a domingo. */
export function rangoPeriodo(periodo: Periodo, fecha: string): { desde: string; hasta: string; etiqueta: string } {
  const [a, m, d] = fecha.split('-').map(Number);
  const dia = (y: number, mo: number, da: number) => new Date(Date.UTC(y, mo - 1, da));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  let ini: Date, fin: Date, etiqueta: string;
  if (periodo === 'diario') { ini = dia(a, m, d); fin = dia(a, m, d + 1); etiqueta = iso(ini); }
  else if (periodo === 'semanal') {
    const base = dia(a, m, d);
    const lunes = (base.getUTCDay() + 6) % 7;
    ini = dia(a, m, d - lunes); fin = dia(a, m, d - lunes + 7);
    etiqueta = `${iso(ini)} a ${iso(dia(a, m, d - lunes + 6))}`;
  } else { ini = dia(a, m, 1); fin = dia(a, m + 1, 1); etiqueta = `${a}-${String(m).padStart(2, '0')}`; }
  return { desde: iso(ini), hasta: iso(fin), etiqueta };
}

/** ¿El folio se levantó en [desde, hasta) (fechas locales AAAA-MM-DD)? */
export const enRango = (creadoEn: string, desde?: string, hasta?: string) => {
  const f = fechaLocal(creadoEn);
  return (!desde || f >= desde) && (!hasta || f < hasta);
};

function agrupar(filas: FilaEstadistica[], clave: (f: FilaEstadistica) => { clave: string; nombre: string } | null): Grupo[] {
  const g = new Map<string, { nombre: string; filas: FilaEstadistica[] }>();
  for (const f of filas) {
    const k = clave(f);
    if (!k) continue;
    const x = g.get(k.clave) ?? { nombre: k.nombre, filas: [] };
    x.filas.push(f);
    g.set(k.clave, x);
  }
  return [...g.entries()]
    .map(([k, x]) => ({
      clave: k,
      nombre: x.nombre,
      reportes: x.filas.length,
      quejas: x.filas.filter((f) => f.queja).length,
      llegada: resumirTiempos(x.filas.map((f) => f.tiempos)).find((e) => e.id === 'llegada')!,
    }))
    .sort((a, b) => b.reportes - a.reportes || a.clave.localeCompare(b.clave));
}

const SIN_CNIE = { clave: 'sin', nombre: 'Sin clasificar' };
const NOMBRE_CORP = new Map<string, string>(CORPORACIONES.map((c) => [c.id, c.nombre]));

export const nombreMunicipio = (f: Pick<FilaEstadistica, 'municipioClave'>) =>
  f.municipioClave ? municipioPorClave(f.municipioClave)?.nombre ?? f.municipioClave : 'Fuera de Querétaro';

/** Estadística completa de un conjunto de folios. */
export function estadistica(filas: FilaEstadistica[]) {
  const califs = filas.flatMap((f) => (f.calificacion ? [f.calificacion] : []));
  return {
    reportes: filas.length,
    quejas: filas.filter((f) => f.queja).length,
    calificacionPromedio: califs.length ? Math.round((califs.reduce((a, b) => a + b, 0) / califs.length) * 10) / 10 : null,
    etapas: resumirTiempos(filas.map((f) => f.tiempos)),
    porMunicipio: agrupar(filas, (f) => ({ clave: f.municipioClave ?? '000', nombre: nombreMunicipio(f) })),
    /** Quién atendió: el CAD del municipio o el C5. */
    porCad: agrupar(filas, (f) => ({ clave: f.cadId, nombre: f.cadId === CAD_ESTATAL_ID ? 'C5 Querétaro' : nombreDeCad(f.cadId) })),
    porTipo: agrupar(filas, (f) => (f.cnie ? { clave: f.cnie.tipo.codigo, nombre: f.cnie.tipo.nombre } : SIN_CNIE)),
    porSubtipo: agrupar(filas, (f) => (f.cnie ? { clave: f.cnie.subtipo.codigo, nombre: f.cnie.subtipo.nombre } : SIN_CNIE)),
    porIncidente: agrupar(filas, (f) => (f.cnie?.incidente ? { clave: f.cnie.incidente.codigo, nombre: f.cnie.incidente.nombre } : f.cnie ? { clave: `${f.cnie.subtipo.codigo}xx`, nombre: `${f.cnie.subtipo.nombre} (sin incidente)` } : SIN_CNIE)),
    porCorporacion: agrupar(filas, (f) => (f.unidad ? { clave: f.unidad.corporacion, nombre: NOMBRE_CORP.get(f.unidad.corporacion) ?? f.unidad.corporacion } : null)),
    porUnidad: agrupar(filas, (f) => (f.unidad ? { clave: f.unidad.unidadId, nombre: f.unidad.etiqueta } : null)),
  };
}
export type Estadistica = ReturnType<typeof estadistica>;

const celda = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** CSV por folio (UTF-8 con BOM para Excel). Sin nombre ni teléfono del reportante. */
export function csvFolios(filas: FilaEstadistica[]): string {
  const enc = ['folio', 'fecha_local', 'municipio_clave', 'municipio', 'cad', 'estado', 'prioridad_operativa', 'cnie_tipo', 'cnie_subtipo', 'cnie_incidente', 'cnie_nombre', 'corporacion', 'unidad', 'recepcion_s', 'asignacion_s', 'salida_s', 'traslado_s', 'llegada_s', 'llegada_meta_s', 'llegada_en_meta', 'queja'];
  const filasCsv = filas.map((f) => {
    const e = Object.fromEntries(f.tiempos.etapas.map((x) => [x.id, x.segundos]));
    const l = f.tiempos.llegada;
    return [
      f.folio, fechaLocal(f.creadoEn), f.municipioClave ?? '', nombreMunicipio(f), nombreDeCad(f.cadId), f.estado, f.prioridad,
      f.cnie?.tipo.codigo ?? '', f.cnie?.subtipo.codigo ?? '', f.cnie?.incidente?.codigo ?? '', f.cnie?.incidente?.nombre ?? f.cnie?.subtipo.nombre ?? '',
      f.unidad?.corporacion ?? '', f.unidad?.etiqueta ?? '',
      e.recepcion ?? '', e.asignacion ?? '', e.salida ?? '', e.traslado ?? '', l.segundos ?? '', l.metaSegundos,
      l.estado === 'cumplida' ? 'si' : l.estado === 'excedida' ? 'no' : '', f.queja ? 'si' : 'no',
    ].map(celda).join(',');
  });
  return `﻿${[enc.join(','), ...filasCsv].join('\r\n')}\r\n`;
}

/** Mínimo de reportes para publicar un grupo en la versión pública (evita identificar casos). */
export const MINIMO_PUBLICO = 5;

/**
 * Versión pública agregada: sin folios, sin ubicaciones, sin unidades y sin datos personales.
 * Los grupos con menos de `MINIMO_PUBLICO` reportes se suman en "Otros".
 */
export function estadisticaPublica(filas: FilaEstadistica[], periodo: { desde: string; hasta: string; etiqueta: string }) {
  const e = estadistica(filas);
  const publicar = (gs: Grupo[]) => {
    const visibles = gs.filter((g) => g.reportes >= MINIMO_PUBLICO);
    const ocultos = gs.filter((g) => g.reportes < MINIMO_PUBLICO);
    const fila = (g: Grupo) => ({ clave: g.clave, nombre: g.nombre, reportes: g.reportes, llegadaMedianaSeg: g.llegada.medianaSegundos, llegadaEnMeta: g.llegada.enMeta, quejas: g.quejas });
    return [...visibles.map(fila), ...(ocultos.length ? [{ clave: 'otros', nombre: `Otros (grupos de menos de ${MINIMO_PUBLICO} reportes)`, reportes: ocultos.reduce((a, g) => a + g.reportes, 0), llegadaMedianaSeg: null, llegadaEnMeta: null, quejas: ocultos.reduce((a, g) => a + g.quejas, 0) }] : [])];
  };
  return {
    periodo,
    reportes: e.reportes,
    etapas: e.reportes >= MINIMO_PUBLICO ? e.etapas.map((x) => ({ id: x.id, nombre: x.nombre, medidos: x.n, medianaSeg: x.medianaSegundos, enMeta: x.enMeta })) : [],
    porMunicipio: publicar(e.porMunicipio),
    porTipo: publicar(e.porTipo),
    porSubtipo: publicar(e.porSubtipo),
    nota: `Datos agregados sin información personal. Los grupos con menos de ${MINIMO_PUBLICO} reportes no se muestran por separado. Metas provisionales.`,
  };
}
