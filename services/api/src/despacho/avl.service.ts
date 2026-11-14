import { Inject, Injectable, Logger } from '@nestjs/common';
import { rutaConRespaldo, type ProveedorRutas, type Punto, type Ruta } from '@pol-iaq/shared';
import { CONFIG, type Config } from '../config';

export interface PosicionUnidad extends Punto { rumbo?: number; en: string }

/**
 * Última posición GPS (AVL) de cada unidad. Llega por `unidad.posicion` del
 * CAD o por el lote firmado `POST /v1/cad/:cadId/avl`. Mientras no llega,
 * se usa la `base` configurada.
 * TODO(fase 2): persistir en PostgreSQL/PostGIS y caducar posiciones viejas.
 */
@Injectable()
export class AvlService {
  private readonly posiciones = new Map<string, PosicionUnidad>();

  constructor(@Inject(CONFIG) private readonly config: Config) {
    const en = new Date(0).toISOString();
    for (const u of config.unidades) if (u.base) this.posiciones.set(u.unidadId, { ...u.base, en });
  }

  actualizar(unidadId: string, p: Omit<PosicionUnidad, 'en'> & { en?: string }) {
    const previa = this.posiciones.get(unidadId);
    const en = p.en ?? new Date().toISOString();
    if (previa && previa.en > en) return; // llegó desordenada
    this.posiciones.set(unidadId, { lat: p.lat, lng: p.lng, rumbo: p.rumbo, en });
  }

  posicion(unidadId: string): PosicionUnidad | undefined {
    return this.posiciones.get(unidadId);
  }
}

/** OSRM: GET /route/v1/driving/{lng,lat;lng,lat}. Solo con un servidor propio o contratado. */
export class ProveedorOsrm implements ProveedorRutas {
  constructor(private readonly base: string, private readonly timeoutMs = 1500) {}

  async ruta(o: Punto, d: Punto): Promise<Ruta> {
    const url = `${this.base.replace(/\/$/, '')}/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=simplified&geometries=geojson`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!resp.ok) throw new Error(`osrm_${resp.status}`);
    const j = (await resp.json()) as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    const r = j.routes?.[0];
    if (!r) throw new Error('osrm_sin_ruta');
    return { metros: Math.round(r.distance), segundos: Math.round(r.duration), trazo: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), fuente: 'ruta' };
  }
}

@Injectable()
export class RutasService {
  private readonly log = new Logger('Rutas');
  private readonly proveedor: ProveedorRutas | null;

  constructor(@Inject(CONFIG) config: Config) {
    this.proveedor = config.rutasOsrmUrl ? new ProveedorOsrm(config.rutasOsrmUrl) : null;
    if (!this.proveedor) this.log.log('Sin ROUTING_OSRM_URL: el tiempo de llegada se estima por calles.');
  }

  ruta(origen: Punto, destino: Punto) {
    return rutaConRespaldo(this.proveedor, origen, destino);
  }
}
