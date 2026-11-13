import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ESTADOS_FINALES, ETIQUETAS_CIUDADANO, type EstadoIncidente } from '@pol-iaq/shared/movil';
import { api, seguir, type ReporteVista } from '../api';
import { tomarYSubirFoto } from '../evidencia';
import { colores, e } from '../estilos';

const PASOS: EstadoIncidente[] = ['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado'];

/**
 * Seguimiento tipo app de entregas: pasos, unidad asignada con tiempo
 * estimado y chat con el operador, todo bajo el folio unificado.
 * TODO(fase 2): mapa con la posición de la unidad (react-native-maps o expo-maps).
 */
export function Seguimiento({ token, folio, alSalir }: { token: string; folio: string; alSalir: () => void }) {
  const [r, setR] = useState<ReporteVista | null>(null);
  const [texto, setTexto] = useState('');

  useEffect(() => {
    api.reporte(token, folio).then(setR).catch(() => undefined);
    const socket = seguir(token, folio, setR);
    return () => {
      socket.close();
    };
  }, [token, folio]);

  if (!r) return <View style={e.pantalla}><Text style={e.texto}>Cargando {folio}…</Text></View>;

  const finalizado = ESTADOS_FINALES.includes(r.estado);
  const indice = PASOS.indexOf(r.estado);

  async function enviarMensaje() {
    if (!texto.trim()) return;
    setR(await api.mensaje(token, folio, texto.trim()));
    setTexto('');
  }

  async function foto() {
    try {
      const res = await tomarYSubirFoto(token, folio);
      if (res === 'sin_permiso') Alert.alert('Permiso de cámara', 'Activa la cámara en los ajustes para adjuntar fotos.');
    } catch {
      Alert.alert('No se subió la foto', 'Revisa tu conexión e intenta de nuevo.');
    }
  }

  return (
    <ScrollView style={e.pantalla} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={e.suave}>Folio</Text>
      <Text style={[e.titulo, { fontVariant: ['tabular-nums'] }]}>{r.folio}</Text>
      <Text style={[e.texto, { fontSize: 18, fontWeight: '600' }]}>{r.estadoTexto}</Text>

      {r.unidad && (
        <View style={[e.tarjeta, { marginTop: 12 }]}>
          <Text style={[e.texto, { fontWeight: '600' }]}>{r.unidad.etiqueta}</Text>
          {r.unidad.etaMinutos !== undefined && r.estado === 'en_camino' && <Text style={e.texto}>Llega en unos {r.unidad.etaMinutos} min</Text>}
        </View>
      )}

      <Text style={e.subtitulo}>Avance</Text>
      {PASOS.map((p, i) => (
        <View key={p} style={[e.fila, { marginBottom: 8 }]}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i <= indice ? colores.ok : colores.borde }} />
          <Text style={[e.texto, i > indice && { color: colores.suave }]}>{ETIQUETAS_CIUDADANO[p]}</Text>
        </View>
      ))}
      {indice === -1 && <Text style={e.texto}>{r.estadoTexto}</Text>}

      {!finalizado && (
        <Pressable style={e.botonSecundario} onPress={foto}>
          <Text style={e.botonSecundarioTexto}>Adjuntar foto</Text>
        </Pressable>
      )}

      <Text style={e.subtitulo}>Mensajes</Text>
      {r.mensajes.map((m) => (
        <View key={m.id} style={[e.tarjeta, m.autor === 'ciudadano' && { backgroundColor: '#EAF2FC' }]}>
          <Text style={e.suave}>{m.autor === 'ciudadano' ? 'Tú' : m.nombreAutor ?? 'Operador'}</Text>
          <Text style={e.texto}>{m.texto}</Text>
        </View>
      ))}
      {!finalizado && (
        <>
          <TextInput style={e.input} placeholder="Escribe al operador" value={texto} onChangeText={setTexto} />
          <Pressable style={e.boton} onPress={enviarMensaje}>
            <Text style={e.botonTexto}>Enviar</Text>
          </Pressable>
          <Pressable style={e.botonSecundario} onPress={async () => setR(await api.cancelar(token, folio))}>
            <Text style={e.botonSecundarioTexto}>Cancelar reporte</Text>
          </Pressable>
        </>
      )}
      <Pressable style={e.botonSecundario} onPress={alSalir}>
        <Text style={e.botonSecundarioTexto}>Volver al inicio</Text>
      </Pressable>
    </ScrollView>
  );
}
