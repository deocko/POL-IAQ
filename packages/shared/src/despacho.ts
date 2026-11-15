/**
 * Despacho por cercanía: distancia, tiempo estimado de llegada y elección de la
 * unidad más cercana con la posición GPS (AVL) de las unidades.
 *
 * El tiempo por defecto es una ESTIMACIÓN por calles (línea recta × factor de
 * trazado urbano a velocidad de emergencia). Con un servicio de rutas
 * configurado (`ProveedorRutas`, p. ej. OSRM propio con la red vial de
 * Querétaro) se usa la ruta real; si falla, se vuelve a la estimación.
 */
import type { Corporacion } from './catalogo';

export interface Punto { lat: number; lng: number }

const RADIO_TIERRA_M = 6_371_000;
const rad = (g: number) => (g * Math.PI) / 180;

/** Distancia en línea recta (haversine), en metros. */
export function distanciaMetros(a: Punto, b: Punto): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cuánto más largo es el trayecto por calles que la línea recta (valor típico urbano; calibrar con datos reales). */
export const FACTOR_CALLES = 1.4;
/** Velocidad media de traslado en emergencia, km/h (provisional; calibrar con el AVL del piloto). */
export const VELOCIDAD_EMERGENCIA_KMH = 35;

export interface Ruta {
  metros: number;
  segundos: number;
  /** Trazo para dibujar en el mapa (puede ser solo origen y destino). */
  trazo: Punto[];
  fuente: 'ruta' | 'estimada';
}

/** Llegada estimada por calles, sin servicio de rutas. */
export function estimarRuta(origen: Punto, destino: Punto, velocidadKmh = VELOCIDAD_EMERGENCIA_KMH): Ruta {
  const metros = Math.round(distanciaMetros(origen, destino) * FACTOR_CALLES);
  return { metros, segundos: Math.round(metros / ((velocidadKmh * 1000) / 3600)), trazo: [origen, destino], fuente: 'estimada' };
}

/** Minutos para mostrar: siempre al menos 1 mientras la unidad no llega. */
export const minutosDe = (segundos: number) => Math.max(1, Math.ceil(segundos / 60));

/** Servicio de rutas reales (p. ej. OSRM). Debe resolver rápido; si falla se usa `estimarRuta`. */
export interface ProveedorRutas {
  ruta(origen: Punto, destino: Punto): Promise<Ruta>;
}

export async function rutaConRespaldo(proveedor: ProveedorRutas | null | undefined, origen: Punto, destino: Punto): Promise<Ruta> {
  if (!proveedor) return estimarRuta(origen, destino);
  try {
    return await proveedor.ruta(origen, destino);
  } catch {
    return estimarRuta(origen, destino);
  }
}

export interface UnidadAvl {
  unidadId: string;
  corporacion: Corporacion | string;
  etiqueta: string;
  /** Última posición GPS conocida; sin ella la unidad no entra en la asignación automática. */
  posicion?: Punto & { en?: string };
  /** false si atiende otro reporte o está fuera de servicio. */
  disponible: boolean;
}

export interface Candidata {
  unidad: UnidadAvl;
  ruta: Ruta;
  /** true si es de la corporación que pide la canalización. */
  delTipo: boolean;
}

/**
 * Unidades disponibles ordenadas por tiempo de llegada: primero las de la
 * corporación pedida; si no hay ninguna disponible, las demás.
 */
export function candidatasPorCercania(unidades: UnidadAvl[], destino: Punto, corporacion?: string, rutaDe: (o: Punto, d: Punto) => Ruta = estimarRuta): Candidata[] {
  const lista = unidades
    .filter((u) => u.disponible && u.posicion)
    .map((u) => ({ unidad: u, ruta: rutaDe(u.posicion!, destino), delTipo: !corporacion || u.corporacion === corporacion }))
    .sort((a, b) => a.ruta.segundos - b.ruta.segundos);
  const delTipo = lista.filter((c) => c.delTipo);
  return delTipo.length ? [...delTipo, ...lista.filter((c) => !c.delTipo)] : lista;
}

/** La unidad que se asigna sola: la más cercana de la corporación pedida. */
export function unidadMasCercana(unidades: UnidadAvl[], destino: Punto, corporacion?: string): Candidata | null {
  return candidatasPorCercania(unidades, destino, corporacion)[0] ?? null;
}
