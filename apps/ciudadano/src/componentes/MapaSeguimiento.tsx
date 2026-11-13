import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { colores } from '../estilos';
import type { PropsMapa } from './tipos-mapa';

const DELTA_INICIAL = 0.012;

/**
 * Mapa del seguimiento (Android e iOS): el lugar del reporte, la unidad
 * asignada y su recorrido reciente. Se reencuadra cuando la unidad se mueve.
 * En web se usa MapaSeguimiento.web.tsx.
 */
export function MapaSeguimiento({ reporte, unidad, recorrido, alto = 260 }: PropsMapa) {
  const mapa = useRef<MapView>(null);

  useEffect(() => {
    if (!unidad) {
      mapa.current?.animateToRegion({ latitude: reporte.lat, longitude: reporte.lng, latitudeDelta: DELTA_INICIAL, longitudeDelta: DELTA_INICIAL }, 400);
      return;
    }
    mapa.current?.fitToCoordinates(
      [{ latitude: reporte.lat, longitude: reporte.lng }, { latitude: unidad.lat, longitude: unidad.lng }],
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
  }, [reporte.lat, reporte.lng, unidad?.lat, unidad?.lng]);

  return (
    <View style={{ height: alto, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colores.borde, marginTop: 12 }}>
      <MapView
        ref={mapa}
        style={{ flex: 1 }}
        initialRegion={{ latitude: reporte.lat, longitude: reporte.lng, latitudeDelta: DELTA_INICIAL, longitudeDelta: DELTA_INICIAL }}
        toolbarEnabled={false}
        accessibilityLabel={unidad ? `Mapa: ${unidad.etiqueta} rumbo a tu ubicación` : 'Mapa con la ubicación de tu reporte'}
      >
        <Marker coordinate={{ latitude: reporte.lat, longitude: reporte.lng }} title="Tu reporte" pinColor={colores.panico} />
        {recorrido.length > 1 && (
          <Polyline coordinates={recorrido.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={colores.primario} strokeWidth={4} lineDashPattern={[6, 6]} />
        )}
        {unidad && (
          <Marker
            coordinate={{ latitude: unidad.lat, longitude: unidad.lng }}
            title={unidad.etiqueta}
            anchor={{ x: 0.5, y: 0.5 }}
            rotation={unidad.rumbo ?? 0}
            flat={unidad.rumbo !== undefined}
            tracksViewChanges={false}
          >
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colores.primario, borderWidth: 3, borderColor: colores.blanco, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colores.blanco, fontSize: 12, fontWeight: '700' }}>{unidad.rumbo !== undefined ? '▲' : '●'}</Text>
            </View>
          </Marker>
        )}
      </MapView>
    </View>
  );
}
