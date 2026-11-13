import { StyleSheet } from 'react-native';

export const colores = {
  fondo: '#F7F8FA',
  texto: '#14181F',
  suave: '#5B6472',
  primario: '#0B4F9C',
  panico: '#C62828',
  borde: '#D9DEE5',
  blanco: '#FFFFFF',
  ok: '#2E7D32',
};

export const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo, padding: 16, paddingTop: 56 },
  titulo: { fontSize: 24, fontWeight: '700', color: colores.texto, marginBottom: 8 },
  subtitulo: { fontSize: 16, fontWeight: '600', color: colores.texto, marginTop: 16, marginBottom: 8 },
  texto: { fontSize: 15, color: colores.texto, lineHeight: 21 },
  suave: { fontSize: 13, color: colores.suave },
  input: { backgroundColor: colores.blanco, borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  boton: { backgroundColor: colores.primario, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  botonTexto: { color: colores.blanco, fontSize: 16, fontWeight: '600' },
  botonSecundario: { borderWidth: 1, borderColor: colores.primario, borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  botonSecundarioTexto: { color: colores.primario, fontSize: 15, fontWeight: '600' },
  tarjeta: { backgroundColor: colores.blanco, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, padding: 14, marginBottom: 10 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { color: colores.panico, marginTop: 8 },
});
