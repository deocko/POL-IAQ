import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';

export const llamar911 = () => Linking.openURL('tel:911');

/** Ubicación actual de alta precisión, o null si la persona no dio permiso (ya se le avisó). */
export async function ubicacionActual(): Promise<{ lat: number; lng: number; precisionMetros?: number } | null> {
  const permiso = await Location.requestForegroundPermissionsAsync();
  if (!permiso.granted) {
    Alert.alert('Ubicación necesaria', 'Sin tu ubicación no podemos enviar una unidad. Puedes llamar al 911.', [
      { text: 'Llamar al 911', onPress: llamar911 },
      { text: 'Cerrar' },
    ]);
    return null;
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, precisionMetros: pos.coords.accuracy ?? undefined };
}

export function avisarFallo() {
  Alert.alert('No se envió el reporte', 'Intenta de nuevo o llama al 911.', [
    { text: 'Llamar al 911', onPress: llamar911 },
    { text: 'Cerrar' },
  ]);
}
