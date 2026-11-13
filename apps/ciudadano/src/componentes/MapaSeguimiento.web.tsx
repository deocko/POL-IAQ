import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { colores } from '../estilos';
import type { PropsMapa } from './tipos-mapa';

/**
 * Versión web del mapa (react-native-maps no funciona en navegador): Leaflet
 * con teselas de OpenStreetMap dentro de un iframe aislado. Las posiciones
 * le llegan por postMessage, así que el mapa no se recarga en cada cambio.
 *
 * TODO(producción): usar un proveedor de teselas con convenio (OSM no permite
 * uso intensivo de sus servidores) y servir Leaflet desde el propio dominio.
 */
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>html,body,#m{margin:0;height:100%}
.u{width:24px;height:24px;border-radius:50%;background:${colores.primario};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:700 11px/24px sans-serif;text-align:center}</style>
</head><body><div id="m"></div><script>
var mapa = L.map('m', { zoomControl: true, attributionControl: true });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa);
var reporte, unidad, linea, encuadreConUnidad = false;
window.addEventListener('message', function (ev) {
  var d = ev.data; if (!d || d.tipo !== 'pol-iaq:mapa') return;
  var r = [d.reporte.lat, d.reporte.lng];
  if (!reporte) { reporte = L.circleMarker(r, { radius: 9, color: '#fff', weight: 3, fillColor: '${colores.panico}', fillOpacity: 1 }).addTo(mapa).bindTooltip('Tu reporte'); mapa.setView(r, 15); }
  else reporte.setLatLng(r);
  if (linea) { linea.remove(); linea = null; }
  if (d.recorrido.length > 1) linea = L.polyline(d.recorrido.map(function (p) { return [p.lat, p.lng]; }), { color: '${colores.primario}', weight: 4, dashArray: '6 6' }).addTo(mapa);
  if (d.unidad) {
    var u = [d.unidad.lat, d.unidad.lng];
    var giro = d.unidad.rumbo == null ? '' : 'transform:rotate(' + d.unidad.rumbo + 'deg)';
    var icono = L.divIcon({ className: '', html: '<div class="u" style="' + giro + '">' + (d.unidad.rumbo == null ? '●' : '▲') + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
    if (!unidad) unidad = L.marker(u, { icon: icono }).addTo(mapa).bindTooltip(d.unidad.etiqueta);
    else unidad.setLatLng(u).setIcon(icono);
    mapa.fitBounds(L.latLngBounds([r, u]), { padding: [40, 40], maxZoom: 17, animate: encuadreConUnidad });
    encuadreConUnidad = true;
  } else if (unidad) { unidad.remove(); unidad = null; encuadreConUnidad = false; }
});
parent.postMessage({ tipo: 'pol-iaq:mapa-listo' }, '*');
</script></body></html>`;

export function MapaSeguimiento({ reporte, unidad, recorrido, alto = 260 }: PropsMapa) {
  const marco = useRef<HTMLIFrameElement>(null);
  const datos = useRef({ reporte, unidad, recorrido });
  datos.current = { reporte, unidad, recorrido };

  const enviar = () => marco.current?.contentWindow?.postMessage({ tipo: 'pol-iaq:mapa', ...datos.current }, '*');

  useEffect(() => {
    const alListo = (ev: MessageEvent) => {
      if (ev.source === marco.current?.contentWindow && ev.data?.tipo === 'pol-iaq:mapa-listo') enviar();
    };
    window.addEventListener('message', alListo);
    return () => window.removeEventListener('message', alListo);
  }, []);

  useEffect(enviar, [reporte.lat, reporte.lng, unidad?.lat, unidad?.lng, unidad?.rumbo, recorrido.length]);

  return (
    <View style={{ height: alto, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colores.borde, marginTop: 12 }}>
      <iframe
        ref={marco}
        title={unidad ? `Mapa: ${unidad.etiqueta} rumbo a tu ubicación` : 'Mapa con la ubicación de tu reporte'}
        srcDoc={HTML}
        sandbox="allow-scripts"
        style={{ border: 0, width: '100%', height: '100%' }}
      />
    </View>
  );
}
