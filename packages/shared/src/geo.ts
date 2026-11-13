import { CAD_ESTATAL_ID, Coordenada, MUNICIPIOS_PILOTO, Municipio } from './municipios';

/** Ray casting: ¿el punto está dentro del polígono? */
export function puntoEnPoligono(punto: Coordenada, poligono: Coordenada[]): boolean {
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
  municipio: Municipio | null;
  cadId: string;
}

/**
 * Decide a qué CAD va un reporte según su ubicación.
 * Fuera de las geocercas piloto, el reporte va al C5 estatal.
 */
export function enrutarPorUbicacion(lat: number, lng: number): Enrutamiento {
  const municipio = MUNICIPIOS_PILOTO.find((m) => puntoEnPoligono([lng, lat], m.geocercaAproximada));
  return municipio ? { municipio, cadId: municipio.cadId } : { municipio: null, cadId: CAD_ESTATAL_ID };
}
