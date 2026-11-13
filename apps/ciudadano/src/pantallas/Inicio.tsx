import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { api, type IncidenteCatalogoPublico } from '../api';
import { colores, e } from '../estilos';

/** Pantalla principal: botón de pánico y catálogo en lenguaje simple. */
export function Inicio({ token, alCrear }: { token: string; alCrear: (folio: string) => void }) {
  const [catalogo, setCatalogo] = useState<IncidenteCatalogoPublico[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.catalogo().then((c) => setCatalogo(c.incidentes)).catch(() => Alert.alert('Sin conexión', 'No pudimos cargar el catálogo. Si es urgente, llama al 911.'));
  }, []);

  async function reportar(incidenteId: string, esPanico = false) {
    setEnviando(true);
    try {
      const permiso = await Location.requestForegroundPermissionsAsync();
      if (!permiso.granted) {
        Alert.alert('Ubicación necesaria', 'Sin tu ubicación no podemos enviar una unidad. Puedes llamar al 911.', [
          { text: 'Llamar al 911', onPress: () => Linking.openURL('tel:911') },
          { text: 'Cerrar' },
        ]);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const r = await api.crearReporte(token, {
        incidenteId,
        esPanico,
        ubicacion: { lat: pos.coords.latitude, lng: pos.coords.longitude, precisionMetros: pos.coords.accuracy ?? undefined },
      });
      alCrear(r.folio);
    } catch {
      Alert.alert('No se envió el reporte', 'Intenta de nuevo o llama al 911.', [
        { text: 'Llamar al 911', onPress: () => Linking.openURL('tel:911') },
        { text: 'Cerrar' },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ScrollView style={e.pantalla} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={e.titulo}>¿Qué está pasando?</Text>
      <Pressable
        style={{ backgroundColor: colores.panico, borderRadius: 12, padding: 22, alignItems: 'center', marginVertical: 12 }}
        onLongPress={() => reportar('otro', true)}
        delayLongPress={800}
        disabled={enviando}
      >
        <Text style={{ color: colores.blanco, fontSize: 22, fontWeight: '800' }}>BOTÓN DE PÁNICO</Text>
        <Text style={{ color: colores.blanco, marginTop: 4 }}>Mantén presionado para enviar tu ubicación</Text>
      </Pressable>
      {enviando && <ActivityIndicator size="large" style={{ marginVertical: 12 }} />}
      <Text style={e.subtitulo}>O elige el tipo de emergencia</Text>
      {catalogo.map((i) => (
        <Pressable key={i.id} style={e.tarjeta} disabled={enviando} onPress={() => reportar(i.id)}>
          <View style={e.fila}>
            <Text style={[e.texto, { flex: 1, fontWeight: '600' }]}>{i.nombreCiudadano}</Text>
            {i.prioridad === 'alta' && <Text style={[e.suave, { color: colores.panico }]}>Urgente</Text>}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
