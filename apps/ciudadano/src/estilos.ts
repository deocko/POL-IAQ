import { StyleSheet } from 'react-native';

/**
 * Tema claro de Pol-IAQ: fondos blancos y azules muy suaves, texto oscuro
 * para buen contraste y un solo color fuerte (coral) reservado para el botón
 * de asistencia directa.
 */
export const colores = {
  fondo: '#F4F8FC',
  tarjeta: '#FFFFFF',
  texto: '#1B2430',
  suave: '#5E6B7A',
  primario: '#2563C9',
  primarioSuave: '#E6EFFC',
  asistencia: '#E04F4F',
  asistenciaSuave: '#FDECEC',
  borde: '#DCE5EF',
  blanco: '#FFFFFF',
  ok: '#2E8B57',
  okSuave: '#E7F5EC',
  aviso: '#9A6700',
  avisoSuave: '#FFF6DD',
  /** Burbuja de la despachadora virtual. */
  despachadora: '#EEF3FA',
};

export const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo, padding: 16, paddingTop: 56 },
  titulo: { fontSize: 24, fontWeight: '700', color: colores.texto, marginBottom: 8 },
  subtitulo: { fontSize: 16, fontWeight: '600', color: colores.texto, marginTop: 16, marginBottom: 8 },
  texto: { fontSize: 15, color: colores.texto, lineHeight: 21 },
  suave: { fontSize: 13, color: colores.suave },
  input: { backgroundColor: colores.blanco, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 12, fontSize: 16, marginBottom: 12, color: colores.texto },
  boton: { backgroundColor: colores.primario, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  botonTexto: { color: colores.blanco, fontSize: 16, fontWeight: '600' },
  botonSecundario: { backgroundColor: colores.primarioSuave, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
  botonSecundarioTexto: { color: colores.primario, fontSize: 15, fontWeight: '600' },
  tarjeta: { backgroundColor: colores.tarjeta, borderRadius: 12, borderWidth: 1, borderColor: colores.borde, padding: 14, marginBottom: 10 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.blanco, paddingVertical: 8, paddingHorizontal: 14 },
  chipActivo: { borderColor: colores.primario, backgroundColor: colores.primarioSuave },
  error: { color: colores.asistencia, marginTop: 8 },
});
