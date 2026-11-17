/**
 * Reporte mensual al Centro Nacional de Información (CNI) del SESNSP y al C5 estatal.
 *
 * Sale directo de los folios (clasificados con el CNIE V 3.0), sin captura a mano y sin datos
 * personales: por mes, clave de municipio INEGI de 5 dígitos y código CNIE (tipo, subtipo e
 * incidente), con el total de reportes, procedentes, improcedentes o cancelados y las medianas de
 * tiempo por etapa.
 *
 * **Cierre mensual.** Al cerrar un mes se guarda el reporte tal cual (`CierreMensual`) y no se
 * vuelve a calcular. Si después un folio de ese mes cambia (de estado, de código CNIE o de
 * municipio), la diferencia sale como ajuste en el cierre del mes siguiente, con su nota.
 *
 * El acomodo de columnas sigue lo pedido por Diego (Mensaje 9); el formato oficial de captura del
 * CNI debe confirmarse con el C5 antes del primer envío (docs/interconexion/SESNSP.md).
 */
import type { EstadoIncidente } from './estados';
import type { FilaEstadistica } from './estadistica';
import { municipioPorClave } from './municipios';
import { ETAPAS, resumirTiempos } from './tiempos';
import { csvDeFilas, libroXlsx } from './xlsx';

/** Procedente: se atiende o se atendió. Improcedente o cancelado: no ameritó atención. */
export type ClaseSesnsp = 'procedente' | 'improcedente_cancelado';
export const claseSesnsp = (estado: EstadoIncidente): ClaseSesnsp => (estado === 'improcedente' || estado === 'cancelado' ? 'improcedente_cancelado' : 'procedente');

export interface FilaSesnsp {
  mes: string;
  /** Clave INEGI de 5 dígitos (22001–22018); vacía si el folio cayó fuera de Querétaro. */
  claveMunicipio: string;
  municipio: string;
  tipo: string; tipoNombre: string;
  subtipo: string; subtipoNombre: string;
  /** Incidente de 5 dígitos; vacío si el folio aún no tiene incidente (solo subtipo o sin clasificar). */
  incidente: string; incidenteNombre: string;
  total: number;
  procedentes: number;
  improcedentesCancelados: number;
  /** Medianas en segundos por etapa (null si no hay mediciones). */
  medianas: Record<(typeof ETAPAS)[number]['id'] | 'llegada', number | null>;
}

/** Lo que se congela de cada folio al cierre (sin datos personales). */
export interface FotoFolio {
  claveMunicipio: string;
  cnie: string;
  clase: ClaseSesnsp;
}

export interface AjusteSesnsp {
  /** Mes cuyo reporte se corrige. */
  mesOrigen: string;
  claveMunicipio: string;
  municipio: string;
  cnie: string;
  deltaTotal: number;
  deltaProcedentes: number;
  deltaImprocedentesCancelados: number;
  nota: string;
}

export interface CierreMensual {
  mes: string;
  cerradoEn: string;
  cerradoPor: string;
  filas: FilaSesnsp[];
  ajustes: AjusteSesnsp[];
  /** Estado conocido de cada folio cerrado hasta este cierre (los de este mes y los ajustados). */
  foto: Record<string, FotoFolio & { mes: string }>;
}

const ZONA = 'America/Mexico_City';
/** "2026-11" en hora de Querétaro. */
export const mesLocal = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7);

const codigoCnie = (f: FilaEstadistica) => f.cnie?.incidente?.codigo ?? f.cnie?.subtipo.codigo ?? 'sin';
const nombreMun = (clave: string) => (clave ? municipioPorClave(clave)?.nombre ?? clave : 'Fuera de Querétaro');

/** Filas del reporte de un mes (agrupadas por municipio y CNIE), ya ordenadas. */
export function filasSesnsp(mes: string, filas: FilaEstadistica[]): FilaSesnsp[] {
  const grupos = new Map<string, FilaEstadistica[]>();
  for (const f of filas) {
    const k = `${f.municipioClave ?? ''}|${codigoCnie(f)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  return [...grupos.entries()].map(([k, fs]) => {
    const [clave] = k.split('|');
    const c = fs[0].cnie;
    const resumen = resumirTiempos(fs.map((f) => f.tiempos));
    return {
      mes,
      claveMunicipio: clave,
      municipio: nombreMun(clave),
      tipo: c?.tipo.codigo ?? '', tipoNombre: c?.tipo.nombre ?? 'Sin clasificar',
      subtipo: c?.subtipo.codigo ?? '', subtipoNombre: c?.subtipo.nombre ?? '',
      incidente: c?.incidente?.codigo ?? '', incidenteNombre: c?.incidente?.nombre ?? '',
      total: fs.length,
      procedentes: fs.filter((f) => claseSesnsp(f.estado) === 'procedente').length,
      improcedentesCancelados: fs.filter((f) => claseSesnsp(f.estado) === 'improcedente_cancelado').length,
      medianas: Object.fromEntries(resumen.map((r) => [r.id, r.medianaSegundos])) as FilaSesnsp['medianas'],
    };
  }).sort((a, b) => a.claveMunicipio.localeCompare(b.claveMunicipio) || a.tipo.localeCompare(b.tipo) || a.subtipo.localeCompare(b.subtipo) || a.incidente.localeCompare(b.incidente));
}

const foto = (f: FilaEstadistica): FotoFolio => ({ claveMunicipio: f.municipioClave ?? '', cnie: codigoCnie(f), clase: claseSesnsp(f.estado) });
const NOMBRE_CLASE: Record<ClaseSesnsp, string> = { procedente: 'procedente', improcedente_cancelado: 'improcedente o cancelado' };

/**
 * Cierra un mes. `delMes` son los folios levantados en ese mes; `anteriores` son los cierres ya
 * hechos (en cualquier orden); `actuales(folio)` da el estado de hoy de un folio de un mes cerrado.
 * No modifica los cierres anteriores: las diferencias salen como ajustes de este cierre.
 */
export function cerrarMes(
  mes: string,
  delMes: FilaEstadistica[],
  anteriores: readonly CierreMensual[],
  actuales: (folio: string) => FilaEstadistica | undefined,
  quien: string,
  ahora = new Date().toISOString(),
): CierreMensual {
  if (anteriores.some((c) => c.mes === mes)) throw new Error(`El mes ${mes} ya está cerrado; no se reescribe.`);
  // Estado conocido de cada folio: el del último cierre que lo registró.
  const conocido = new Map<string, FotoFolio & { mes: string }>();
  for (const c of [...anteriores].sort((a, b) => a.mes.localeCompare(b.mes))) for (const [folio, x] of Object.entries(c.foto)) conocido.set(folio, x);

  const ajustesPorClave = new Map<string, AjusteSesnsp>();
  const sumar = (mesOrigen: string, x: FotoFolio, signo: 1 | -1, nota: string) => {
    const k = `${mesOrigen}|${x.claveMunicipio}|${x.cnie}`;
    const a = ajustesPorClave.get(k) ?? { mesOrigen, claveMunicipio: x.claveMunicipio, municipio: nombreMun(x.claveMunicipio), cnie: x.cnie, deltaTotal: 0, deltaProcedentes: 0, deltaImprocedentesCancelados: 0, nota: '' };
    a.deltaTotal += signo;
    if (x.clase === 'procedente') a.deltaProcedentes += signo; else a.deltaImprocedentesCancelados += signo;
    a.nota = a.nota ? `${a.nota}; ${nota}` : nota;
    ajustesPorClave.set(k, a);
  };
  const fotoNueva: CierreMensual['foto'] = {};
  for (const [folio, antes] of conocido) {
    const hoy = actuales(folio);
    if (!hoy) continue;
    const ahoraF = foto(hoy);
    if (ahoraF.claveMunicipio === antes.claveMunicipio && ahoraF.cnie === antes.cnie && ahoraF.clase === antes.clase) continue;
    const cambios = [
      antes.clase !== ahoraF.clase && `de ${NOMBRE_CLASE[antes.clase]} a ${NOMBRE_CLASE[ahoraF.clase]}`,
      antes.cnie !== ahoraF.cnie && `CNIE ${antes.cnie} a ${ahoraF.cnie}`,
      antes.claveMunicipio !== ahoraF.claveMunicipio && `municipio ${antes.claveMunicipio || '—'} a ${ahoraF.claveMunicipio || '—'}`,
    ].filter(Boolean).join(', ');
    const nota = `Corrección del ${antes.mes}: folio ${folio} cambió ${cambios} después del cierre`;
    sumar(antes.mes, antes, -1, nota);
    sumar(antes.mes, ahoraF, 1, nota);
    fotoNueva[folio] = { ...ahoraF, mes: antes.mes };
  }
  for (const f of delMes) fotoNueva[f.folio] = { ...foto(f), mes };
  return {
    mes,
    cerradoEn: ahora,
    cerradoPor: quien,
    filas: filasSesnsp(mes, delMes),
    ajustes: [...ajustesPorClave.values()].sort((a, b) => a.mesOrigen.localeCompare(b.mesOrigen) || a.claveMunicipio.localeCompare(b.claveMunicipio) || a.cnie.localeCompare(b.cnie)),
    foto: fotoNueva,
  };
}

const ENCABEZADO = [
  'mes', 'clave_municipio', 'municipio', 'cnie_tipo', 'cnie_tipo_nombre', 'cnie_subtipo', 'cnie_subtipo_nombre', 'cnie_incidente', 'cnie_incidente_nombre',
  'total_reportes', 'procedentes', 'improcedentes_cancelados',
  ...ETAPAS.map((e) => `mediana_${e.id}_s`), 'mediana_llegada_s',
];
const ENCABEZADO_AJUSTES = ['mes_reporte', 'mes_corregido', 'clave_municipio', 'municipio', 'cnie', 'delta_total', 'delta_procedentes', 'delta_improcedentes_cancelados', 'nota'];

export function tablaSesnsp(c: Pick<CierreMensual, 'filas'>): (string | number | null)[][] {
  return [ENCABEZADO, ...c.filas.map((f) => [
    f.mes, f.claveMunicipio, f.municipio, f.tipo, f.tipoNombre, f.subtipo, f.subtipoNombre, f.incidente, f.incidenteNombre,
    f.total, f.procedentes, f.improcedentesCancelados, ...ETAPAS.map((e) => f.medianas[e.id]), f.medianas.llegada,
  ])];
}

export function tablaAjustes(c: Pick<CierreMensual, 'mes' | 'ajustes'>): (string | number | null)[][] {
  return [ENCABEZADO_AJUSTES, ...c.ajustes.map((a) => [c.mes, a.mesOrigen, a.claveMunicipio, a.municipio, a.cnie, a.deltaTotal, a.deltaProcedentes, a.deltaImprocedentesCancelados, a.nota])];
}

/** CSV del reporte del mes; los ajustes van en un segundo archivo (`csvAjustesSesnsp`). */
export const csvSesnsp = (c: CierreMensual | Pick<CierreMensual, 'filas'>) => csvDeFilas(tablaSesnsp(c));
export const csvAjustesSesnsp = (c: Pick<CierreMensual, 'mes' | 'ajustes'>) => csvDeFilas(tablaAjustes(c));

/** Excel con tres hojas: Reporte, Ajustes y Notas. */
export function xlsxSesnsp(c: CierreMensual | (Pick<CierreMensual, 'mes' | 'filas' | 'ajustes'> & { cerradoEn?: string })): Uint8Array {
  const cerrado = 'cerradoEn' in c && c.cerradoEn ? `Cierre del ${c.mes}, congelado el ${c.cerradoEn}.` : `Vista previa del ${c.mes}: aún no está cerrado y puede cambiar.`;
  return libroXlsx([
    { nombre: 'Reporte', filas: tablaSesnsp(c) },
    { nombre: 'Ajustes', filas: tablaAjustes(c) },
    { nombre: 'Notas', filas: [
      ['nota'],
      [cerrado],
      ['Fuente: folios de POL-IAQ clasificados con el CNIE V 3.0 (SESNSP). Sin datos personales: solo conteos y tiempos.'],
      ['clave_municipio: clave INEGI de 5 dígitos (22001-22018). Procedentes: atendidos o en atención. Improcedentes o cancelados: no ameritaron atención.'],
      ['Medianas en segundos; una etapa hecha en el mismo paso que la anterior no se cuenta. Metas de tiempo provisionales.'],
      ['Ajustes: cambios a folios de meses ya cerrados, que se reportan en este mes con su nota.'],
    ] },
  ]);
}
