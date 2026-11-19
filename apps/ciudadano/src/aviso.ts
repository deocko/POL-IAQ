import { Alert, Platform, type AlertButton } from 'react-native';

/** Aviso al usuario. En web `Alert.alert` no hace nada, así que se usan los diálogos del navegador. */
export function avisar(titulo: string, mensaje: string, botones?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(titulo, mensaje, botones);
    return;
  }
  const texto = `${titulo}\n\n${mensaje}`;
  const accion = botones?.find((b) => b.onPress);
  if (!accion) {
    globalThis.alert(texto);
  } else if (globalThis.confirm(`${texto}\n\n¿${accion.text}?`)) {
    accion.onPress?.();
  }
}
