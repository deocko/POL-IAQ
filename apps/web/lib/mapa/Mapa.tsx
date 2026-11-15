'use client';

/**
 * Mapa en vivo (Leaflet + teselas de OpenStreetMap), equivalente web de
 * MapaSeguimiento de la app móvil: el lugar del reporte, la unidad asignada
 * con su rumbo y el trayecto que le falta. En la consola puede mostrar además
 * las demás unidades con su GPS (AVL).
 *
 * TODO(producción): proveedor de teselas con convenio (OSM no permite uso
 * intensivo de sus servidores).
 */
import 'leaflet/dist/leaflet.css';
import './mapa.css';
import { useEffect, useRef } from 'react';
import type * as L from 'leaflet';

export interface PuntoMapa { lat: number; lng: number }
export interface UnidadMapa extends PuntoMapa { id: string; etiqueta: string; rumbo?: number; ocupada?: boolean; asignada?: boolean }

export function Mapa({
  reporte, unidad, unidades = [], alto = 260, titulo, etiquetaReporte = 'Lugar del reporte',
}: {
  reporte?: PuntoMapa | null;
  unidad?: UnidadMapa | null;
  /** Otras unidades (AVL) para la consola. */
  unidades?: UnidadMapa[];
  alto?: number;
  titulo: string;
  etiquetaReporte?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const estado = useRef<{ L: typeof L; mapa: L.Map; capa: L.LayerGroup; encuadrado: string } | null>(null);
  const datos = useRef({ reporte, unidad, unidades, etiquetaReporte });
  datos.current = { reporte, unidad, unidades, etiquetaReporte };

  function pintar() {
    const s = estado.current;
    if (!s) return;
    const { L: Lf, mapa, capa } = s;
    const { reporte: r, unidad: u, unidades: otras, etiquetaReporte: et } = datos.current;
    capa.clearLayers();
    const puntos: L.LatLngExpression[] = [];
    for (const o of otras) {
      if (u && o.id === u.id) continue;
      Lf.marker([o.lat, o.lng], {
        icon: Lf.divIcon({ className: '', html: `<div class="m-unidad ${o.ocupada ? 'ocupada' : 'libre'}" aria-hidden="true">${o.ocupada ? '■' : '●'}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        keyboard: false,
      }).bindTooltip(`${o.etiqueta}${o.ocupada ? ' · ocupada' : ' · libre'}`).addTo(capa);
      puntos.push([o.lat, o.lng]);
    }
    if (r) {
      Lf.circleMarker([r.lat, r.lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#d93b3b', fillOpacity: 1 }).bindTooltip(et).addTo(capa);
      puntos.push([r.lat, r.lng]);
    }
    if (u) {
      if (r) Lf.polyline([[u.lat, u.lng], [r.lat, r.lng]], { color: '#2563c9', weight: 4, dashArray: '6 8' }).addTo(capa);
      const giro = u.rumbo == null ? '' : `transform:rotate(${Math.round(u.rumbo)}deg)`;
      Lf.marker([u.lat, u.lng], {
        icon: Lf.divIcon({ className: '', html: `<div class="m-asignada" style="${giro}" aria-hidden="true">${u.rumbo == null ? '●' : '▲'}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        keyboard: false,
        zIndexOffset: 1000,
      }).bindTooltip(u.etiqueta, { permanent: true, direction: 'top', offset: [0, -14], className: 'm-etiqueta' }).addTo(capa);
      puntos.push([u.lat, u.lng]);
    }
    // Encuadre solo cuando cambia lo que hay que ver (no en cada movimiento).
    const clave = `${r ? `${r.lat},${r.lng}` : ''}|${u?.id ?? ''}|${otras.length}`;
    if (clave !== s.encuadrado && puntos.length) {
      s.encuadrado = clave;
      if (puntos.length === 1) mapa.setView(puntos[0], 15);
      else mapa.fitBounds(Lf.latLngBounds(puntos), { padding: [36, 36], maxZoom: 16 });
    } else if (u && r && !mapa.getBounds().contains([u.lat, u.lng])) {
      mapa.fitBounds(Lf.latLngBounds([[u.lat, u.lng], [r.lat, r.lng]]), { padding: [36, 36], maxZoom: 16 });
    }
  }

  useEffect(() => {
    let cancelado = false;
    void import('leaflet').then((mod) => {
      if (cancelado || !caja.current) return;
      const Lf = (mod as unknown as { default?: typeof L }).default ?? (mod as unknown as typeof L);
      const mapa = Lf.map(caja.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
      Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa);
      mapa.setView([20.5888, -100.3899], 12);
      estado.current = { L: Lf, mapa, capa: Lf.layerGroup().addTo(mapa), encuadrado: '' };
      pintar();
    });
    return () => {
      cancelado = true;
      if (estado.current) { estado.current.mapa.off(); estado.current.mapa.remove(); }
      estado.current = null;
    };
  }, []);

  useEffect(pintar);

  return <div ref={caja} className="m-mapa" style={{ height: alto }} role="img" aria-label={titulo} />;
}
