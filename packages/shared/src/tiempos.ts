/**
 * Tiempos de respuesta por etapa y su meta.
 *
 * Las metas son PROVISIONALES y configurables: no son una norma oficial.
 * Deben acordarse con cada municipio y el C5 antes del piloto.
 */
import type { Prioridad } from './catalogo';
import type { EstadoIncidente } from './estados';

export const ETAPAS = [
  { id: 'recepcion', nombre: 'Recepción', ciudadano: 'Un operador revisa tu reporte', desde: 'recibido', hasta: 'validado' },
  { id: 'asignacion', nombre: 'Asignación', ciudadano: 'Se asigna una unidad', desde: 'validado', hasta: 'asignado' },
  { id: 'salida', nombre: 'Salida', ciudadano: 'La unidad sale', desde: 'asignado', hasta: 'en_camino' },
  { id: 'traslado', nombre: 'Traslado', ciudadano: 'La unidad va en camino', desde: 'en_camino', hasta: 'en_sitio' },
] as const satisfies readonly { id: string; nombre: string; ciudadano: string; desde: EstadoIncidente; hasta: EstadoIncidente }[];
export type EtapaId = (typeof ETAPAS)[number]['id'];

export interface MetasTiempo {
  version: string;
  estado: 'provisional' | 'vigente';
  /** Segundos por etapa y prioridad. */
  etapas: Record<EtapaId, Record<Prioridad, number>>;
  /** Segundos desde que se levanta el reporte hasta que la unidad llega. */
  llegada: Record<Prioridad, number>;
}

export const METAS_PROVISIONALES: MetasTiempo = {
  version: '2026.11-provisional.1',
  estado: 'provisional',
  etapas: {
    recepcion: { alta: 60, media: 90, baja: 180 },
    asignacion: { alta: 60, media: 120, baja: 300 },
    salida: { alta: 60, media: 120, baja: 300 },
    traslado: { alta: 600, media: 900, baja: 1500 },
  },
  llegada: { alta: 780, media: 1200, baja: 2100 },
};

export type EstadoEtapa = 'cumplida' | 'excedida' | 'en_curso' | 'en_riesgo' | 'pendiente' | 'omitida';

export interface TiempoEtapa {
  id: EtapaId;
  nombre: string;
  ciudadano: string;
  segundos: number | null;
  metaSegundos: number;
  estado: EstadoEtapa;
  /** La etapa empezó y terminó en el mismo paso que la anterior: no se mide (no cuenta como 0 s). */
  simultanea?: true;
}

export interface TiemposReporte {
  etapas: TiempoEtapa[];
  /** Desde el alta hasta la llegada (o hasta ahora si sigue en curso). */
  llegada: { segundos: number | null; metaSegundos: number; estado: EstadoEtapa };
  metasVersion: string;
}

/**
 * Dos hitos a menos de 1 s son el mismo paso (una sola acción guarda los dos con milisegundos de diferencia):
 * ninguna etapa real de atención dura menos de un segundo.
 */
export const MISMO_PASO_MS = 1000;

const FINALES: EstadoIncidente[] = ['cerrado', 'improcedente', 'cancelado'];

/** Mide cada etapa con la primera vez que el reporte llegó a cada estado. */
export function medirTiempos(
  historial: { estado: EstadoIncidente; en: string }[],
  prioridad: Prioridad,
  ahora = Date.now(),
  metas: MetasTiempo = METAS_PROVISIONALES,
): TiemposReporte {
  const primera = new Map<EstadoIncidente, number>();
  for (const h of historial) if (!primera.has(h.estado)) primera.set(h.estado, new Date(h.en).getTime());
  const estadoActual = historial.at(-1)?.estado;
  const terminado = !!estadoActual && FINALES.includes(estadoActual);
  const inicioReporte = primera.get('recibido') ?? (historial[0] ? new Date(historial[0].en).getTime() : ahora);

  let finAnterior: number | undefined = inicioReporte;
  const etapas = ETAPAS.map((e): TiempoEtapa => {
    const meta = metas.etapas[e.id][prioridad];
    const inicio = primera.get(e.desde) ?? finAnterior;
    const fin = primera.get(e.hasta);
    let r: Pick<TiempoEtapa, 'segundos' | 'estado' | 'simultanea'>;
    if (inicio !== undefined && fin !== undefined && fin - inicio < MISMO_PASO_MS) {
      // La etapa empezó y terminó en el mismo paso (p. ej. "recibir" asigna sola la unidad más cercana, o se
      // marcó la llegada sin haber salido): no hay tiempo de esa etapa que medir. Contarla como 0 s bajaría
      // la mediana a 0 y daría un cumplimiento falso, en cualquier etapa.
      r = { segundos: null, estado: 'omitida', simultanea: true };
    } else if (inicio !== undefined && fin !== undefined) {
      const s = Math.max(0, Math.round((fin - inicio) / 1000));
      r = { segundos: s, estado: s <= meta ? 'cumplida' : 'excedida' };
    } else if (inicio !== undefined && !terminado) {
      const s = Math.max(0, Math.round((ahora - inicio) / 1000));
      r = { segundos: s, estado: s > meta ? 'excedida' : s > meta * 0.75 ? 'en_riesgo' : 'en_curso' };
    } else {
      r = { segundos: null, estado: terminado ? 'omitida' : 'pendiente' };
    }
    finAnterior = fin;
    return { id: e.id, nombre: e.nombre, ciudadano: e.ciudadano, metaSegundos: meta, ...r };
  });

  const metaLlegada = metas.llegada[prioridad];
  const llegada = primera.get('en_sitio');
  let total: TiemposReporte['llegada'];
  if (llegada !== undefined) {
    const s = Math.round((llegada - inicioReporte) / 1000);
    total = { segundos: s, metaSegundos: metaLlegada, estado: s <= metaLlegada ? 'cumplida' : 'excedida' };
  } else if (!terminado) {
    const s = Math.round((ahora - inicioReporte) / 1000);
    total = { segundos: s, metaSegundos: metaLlegada, estado: s > metaLlegada ? 'excedida' : s > metaLlegada * 0.75 ? 'en_riesgo' : 'en_curso' };
  } else {
    total = { segundos: null, metaSegundos: metaLlegada, estado: 'omitida' };
  }
  return { etapas, llegada: total, metasVersion: metas.version };
}

export interface ResumenEtapa {
  id: EtapaId | 'llegada';
  nombre: string;
  /** Mediciones terminadas. */
  n: number;
  promedioSegundos: number | null;
  medianaSegundos: number | null;
  /** Porcentaje de mediciones terminadas dentro de la meta (0-100). */
  enMeta: number | null;
  /** Veces que la etapa se hizo en el mismo paso que la anterior (no entran en el promedio ni la mediana). */
  sinMedir: number;
}

/** Tablero: promedio, mediana y cumplimiento de meta por etapa. */
export function resumirTiempos(mediciones: TiemposReporte[]): ResumenEtapa[] {
  const filas: { id: ResumenEtapa['id']; nombre: string; valores: { s: number; ok: boolean }[]; sinMedir: number }[] = [
    ...ETAPAS.map((e) => ({ id: e.id as ResumenEtapa['id'], nombre: e.nombre, valores: [] as { s: number; ok: boolean }[], sinMedir: 0 })),
    { id: 'llegada', nombre: 'Llegada total', valores: [], sinMedir: 0 },
  ];
  for (const m of mediciones) {
    m.etapas.forEach((e, i) => {
      if (e.simultanea) filas[i].sinMedir++;
      else if (e.segundos !== null && (e.estado === 'cumplida' || e.estado === 'excedida')) filas[i].valores.push({ s: e.segundos, ok: e.estado === 'cumplida' });
    });
    if (m.llegada.segundos !== null && (m.llegada.estado === 'cumplida' || m.llegada.estado === 'excedida')) filas[ETAPAS.length].valores.push({ s: m.llegada.segundos, ok: m.llegada.estado === 'cumplida' });
  }
  return filas.map(({ id, nombre, valores, sinMedir }) => {
    if (!valores.length) return { id, nombre, n: 0, promedioSegundos: null, medianaSegundos: null, enMeta: null, sinMedir };
    const orden = valores.map((v) => v.s).sort((a, b) => a - b);
    const mitad = Math.floor(orden.length / 2);
    return {
      id,
      nombre,
      n: valores.length,
      promedioSegundos: Math.round(orden.reduce((a, b) => a + b, 0) / orden.length),
      medianaSegundos: orden.length % 2 ? orden[mitad] : Math.round((orden[mitad - 1] + orden[mitad]) / 2),
      enMeta: Math.round((valores.filter((v) => v.ok).length / valores.length) * 100),
      sinMedir,
    };
  });
}

/** "4 min 05 s" / "45 s". */
export function duracionTexto(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')} s` : `${m} min`;
}

/** Reportes, quejas y llegada de un tipo o subtipo del CNIE. */
export interface GrupoCnie {
  codigo: string;
  nombre: string;
  reportes: number;
  quejas: number;
  /** Llegada total (desde que se levanta hasta que la unidad llega) de los reportes del grupo. */
  llegada: ResumenEtapa;
}

/**
 * Agrupa el tablero por tipo y por subtipo del CNIE. Los reportes sin
 * clasificación (por ejemplo, "Otra emergencia" que el operador aún no
 * clasifica, o folios anteriores al CNIE) van en "Sin clasificar".
 */
export function agruparPorCnie(
  items: { cnie?: { tipo: { codigo: string; nombre: string }; subtipo: { codigo: string; nombre: string } } | null; tiempos: TiemposReporte; queja?: boolean }[],
  nombreSubtipo: (codigo: string, nombre: string) => string = (_c, n) => n,
): { tipos: GrupoCnie[]; subtipos: GrupoCnie[] } {
  const agrupar = (clave: (i: (typeof items)[number]) => { codigo: string; nombre: string }) => {
    const grupos = new Map<string, { nombre: string; lista: typeof items }>();
    for (const i of items) {
      const k = clave(i);
      const g = grupos.get(k.codigo) ?? { nombre: k.nombre, lista: [] };
      g.lista.push(i);
      grupos.set(k.codigo, g);
    }
    return [...grupos.entries()]
      .map(([codigo, g]): GrupoCnie => ({
        codigo,
        nombre: g.nombre,
        reportes: g.lista.length,
        quejas: g.lista.filter((x) => x.queja).length,
        llegada: resumirTiempos(g.lista.map((x) => x.tiempos)).find((e) => e.id === 'llegada')!,
      }))
      .sort((a, b) => b.reportes - a.reportes || a.codigo.localeCompare(b.codigo));
  };
  const SIN = { codigo: 'sin', nombre: 'Sin clasificar' };
  return {
    tipos: agrupar((i) => (i.cnie ? i.cnie.tipo : SIN)),
    subtipos: agrupar((i) => (i.cnie ? { codigo: i.cnie.subtipo.codigo, nombre: nombreSubtipo(i.cnie.subtipo.codigo, i.cnie.subtipo.nombre) } : SIN)),
  };
}
