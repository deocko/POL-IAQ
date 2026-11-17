import { CAD_ESTATAL_ID, Coordenada, MUNICIPIOS_QRO, Municipio, NOMBRE_RESPALDO_ESTATAL } from './municipios';

/** Ray casting: ¿el punto está dentro del polígono? */
export function puntoEnPoligono(punto: Coordenada, poligono: readonly (readonly [number, number])[]): boolean {
  const [x, y] = punto;
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    const cruza = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

/**
 * Por qué un folio lo atiende el respaldo estatal (CQ CIAS) y no el CAD del municipio.
 * - `anonimo_089`: el ciudadano pidió el reporte anónimo; va por el 089 al CQ CIAS.
 * - `fuera_de_queretaro`: el punto no cae en ninguno de los 18 municipios.
 * - `municipio_sin_conectar`: el municipio aún no se da de alta en POL-IAQ.
 * - `sin_capacidad`: el municipio está conectado pero no puede contestar (sin unidades en servicio o sin operador).
 * El escalamiento por falta de acuse (después de creado el folio) es aparte y se mantiene.
 */
export type MotivoRespaldo = 'anonimo_089' | 'fuera_de_queretaro' | 'municipio_sin_conectar' | 'sin_capacidad';

export const TEXTO_RESPALDO: Record<MotivoRespaldo, string> = {
  anonimo_089: 'reporte anónimo (089)',
  fuera_de_queretaro: 'fuera de los municipios de Querétaro',
  municipio_sin_conectar: 'municipio sin CAD conectado',
  sin_capacidad: 'municipio sin capacidad',
};

export interface Enrutamiento {
  /** Municipio donde cae el punto (null fuera de Querétaro). Su clave va en el folio. */
  municipio: Municipio | null;
  /** CAD que atiende: el del municipio si está conectado y con capacidad; si no, el CQ CIAS. */
  cadId: string;
  /** null = lo atiende el CAD del municipio. */
  motivo: MotivoRespaldo | null;
  /** Detalle del motivo (p. ej. "sin unidades en servicio"). */
  detalle?: string;
  /** Línea por la que entra: 911, o 089 si es anónimo. */
  canal: '911' | '089';
}

/** Cómo se enrutó el folio al crearse. Se guarda en el folio; no lleva datos personales. */
export interface RutaFolio {
  /** CAD al que se mandó al crearlo (antes de un escalamiento o transferencia). */
  cadOrigen: string;
  motivo: MotivoRespaldo | null;
  detalle?: string;
  canal: '911' | '089';
}

export const rutaDe = (e: Enrutamiento): RutaFolio => ({ cadOrigen: e.cadId, motivo: e.motivo, ...(e.detalle && { detalle: e.detalle }), canal: e.canal });

/** Cómo se muestra el canal de un reporte anónimo en el folio y en la consola. */
export const TEXTO_ANONIMA_089 = `Anónima (089 → ${NOMBRE_RESPALDO_ESTATAL})`;

/** "Atiende CQ CIAS — municipio sin capacidad (sin unidades en servicio)", o null si lo atiende el municipio. */
export function textoRespaldo(r: Pick<RutaFolio, 'motivo' | 'detalle'> | null | undefined): string | null {
  if (!r?.motivo) return null;
  return `Atiende ${NOMBRE_RESPALDO_ESTATAL} — ${TEXTO_RESPALDO[r.motivo]}${r.detalle ? ` (${r.detalle})` : ''}`;
}

/** Municipio de Querétaro donde cae el punto (geocerca), o null. */
export function municipioEn(lat: number, lng: number, geocercas?: (m: Municipio) => readonly (readonly [number, number])[]): Municipio | null {
  return MUNICIPIOS_QRO.find((m) => puntoEnPoligono([lng, lat], geocercas?.(m) ?? m.geocerca)) ?? null;
}

/**
 * Decide a qué CAD va un reporte según su ubicación (geocerca + clave INEGI).
 * `conectado(cadId)` dice si ese municipio ya opera en POL-IAQ (Modo A o B); por omisión, solo los
 * pilotos. `extra.capacidad(cadId)` devuelve null si el municipio puede contestar, o el motivo si no.
 * `extra.anonimo` manda el reporte por el 089 al CQ CIAS. En los demás casos sin CAD municipal, también
 * va al CQ CIAS. La clave del municipio se conserva siempre.
 */
export function enrutarPorUbicacion(
  lat: number,
  lng: number,
  conectado: (cadId: string) => boolean = (cadId) => MUNICIPIOS_QRO.some((m) => m.piloto && m.cadId === cadId),
  geocercas?: (m: Municipio) => readonly (readonly [number, number])[],
  extra: { capacidad?: (cadId: string) => string | null; anonimo?: boolean } = {},
): Enrutamiento {
  const municipio = municipioEn(lat, lng, geocercas);
  const respaldo = (motivo: MotivoRespaldo, detalle?: string): Enrutamiento => ({ municipio, cadId: CAD_ESTATAL_ID, motivo, ...(detalle && { detalle }), canal: motivo === 'anonimo_089' ? '089' : '911' });
  if (extra.anonimo) return respaldo('anonimo_089');
  if (!municipio) return respaldo('fuera_de_queretaro');
  if (!conectado(municipio.cadId)) return respaldo('municipio_sin_conectar');
  const sinCapacidad = extra.capacidad?.(municipio.cadId) ?? null;
  if (sinCapacidad) return respaldo('sin_capacidad', sinCapacidad);
  return { municipio, cadId: municipio.cadId, motivo: null, canal: '911' };
}

/** Un punto dentro del polígono, lo más cerca posible de su centro (rejilla de n×n). Sirve para pruebas. */
export function puntoInterior(poligono: readonly (readonly [number, number])[], n = 40): { lat: number; lng: number } | null {
  const xs = poligono.map((p) => p[0]);
  const ys = poligono.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  let mejor: { lat: number; lng: number } | null = null;
  let d = Infinity;
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      const lng = x0 + ((x1 - x0) * i) / n;
      const lat = y0 + ((y1 - y0) * j) / n;
      if (!puntoEnPoligono([lng, lat], poligono)) continue;
      const dd = (lng - cx) ** 2 + (lat - cy) ** 2;
      if (dd < d) { d = dd; mejor = { lat: +lat.toFixed(5), lng: +lng.toFixed(5) }; }
    }
  }
  return mejor;
}
