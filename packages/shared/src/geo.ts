import { CAD_ESTATAL_ID, Coordenada, MUNICIPIOS_QRO, Municipio } from './municipios';

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

export interface Enrutamiento {
  /** Municipio donde cae el punto (null fuera de Querétaro). Su clave va en el folio. */
  municipio: Municipio | null;
  /** CAD que atiende: el del municipio si está conectado; si no, el C5. */
  cadId: string;
}

/** Municipio de Querétaro donde cae el punto (geocerca), o null. */
export function municipioEn(lat: number, lng: number, geocercas?: (m: Municipio) => readonly (readonly [number, number])[]): Municipio | null {
  return MUNICIPIOS_QRO.find((m) => puntoEnPoligono([lng, lat], geocercas?.(m) ?? m.geocerca)) ?? null;
}

/**
 * Decide a qué CAD va un reporte según su ubicación (geocerca + clave INEGI).
 * `conectado(cadId)` dice si ese municipio ya opera en POL-IAQ (Modo A o B); por omisión, solo los
 * pilotos. Un municipio no conectado, o un punto fuera del estado, va al C5 estatal.
 */
export function enrutarPorUbicacion(
  lat: number,
  lng: number,
  conectado: (cadId: string) => boolean = (cadId) => MUNICIPIOS_QRO.some((m) => m.piloto && m.cadId === cadId),
  geocercas?: (m: Municipio) => readonly (readonly [number, number])[],
): Enrutamiento {
  const municipio = municipioEn(lat, lng, geocercas);
  return { municipio, cadId: municipio && conectado(municipio.cadId) ? municipio.cadId : CAD_ESTATAL_ID };
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
