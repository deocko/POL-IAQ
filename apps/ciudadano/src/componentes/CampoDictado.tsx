import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { colores, e } from '../estilos';

/**
 * Campo que dicta: el identificador del campo que tiene el micrófono. Los
 * eventos de reconocimiento son globales, así que cada campo (y la llamada por
 * voz de la despachadora) revisa si el dictado es suyo.
 */
let campoActivo: symbol | null = null;
export const hayDictadoEnCurso = () => campoActivo !== null;

/** Lo dictado se agrega al final de lo que ya estaba escrito. */
function unir(previo: string, dicho: string) {
  const a = previo.trimEnd();
  return a ? `${a} ${dicho}` : dicho;
}

/**
 * TextInput con botón de micrófono: la persona habla y lo que dice se escribe
 * en el campo (es-MX), para que lo revise antes de enviarlo.
 */
export function CampoDictado({ value, onChangeText, style, estiloContenedor, ...props }: Omit<TextInputProps, 'value' | 'onChangeText'> & { value: string; onChangeText: (t: string) => void; estiloContenedor?: ViewStyle }) {
  const id = useRef(Symbol('campo')).current;
  const previo = useRef('');
  const [oyendo, setOyendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const terminar = () => {
    if (campoActivo === id) campoActivo = null;
    setOyendo(false);
  };

  useSpeechRecognitionEvent('result', (ev) => {
    if (campoActivo !== id) return;
    const dicho = ev.results[0]?.transcript?.trim();
    if (dicho) onChangeText(unir(previo.current, dicho));
  });
  useSpeechRecognitionEvent('end', () => { if (campoActivo === id) terminar(); });
  useSpeechRecognitionEvent('error', (ev) => {
    if (campoActivo !== id) return;
    terminar();
    setAviso(ev.error === 'not-allowed' ? 'Sin permiso de micrófono. Puedes escribir.' : ev.error === 'no-speech' ? 'No te escuché. Toca el micrófono e intenta de nuevo.' : 'No pudimos usar el micrófono. Puedes escribir.');
  });
  useEffect(() => () => {
    if (campoActivo === id) {
      ExpoSpeechRecognitionModule.abort();
      campoActivo = null;
    }
  }, [id]);

  async function alternar() {
    setAviso(null);
    if (oyendo) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setAviso('Este dispositivo no permite dictar. Puedes escribir.');
        return;
      }
      const permiso = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permiso.granted) {
        setAviso('Sin permiso de micrófono. Puedes escribir.');
        return;
      }
      if (campoActivo) ExpoSpeechRecognitionModule.abort();
      campoActivo = id;
      previo.current = value;
      setOyendo(true);
      ExpoSpeechRecognitionModule.start({ lang: 'es-MX', interimResults: true, continuous: false });
    } catch {
      terminar();
      setAviso('No pudimos usar el micrófono. Puedes escribir.');
    }
  }

  return (
    <View style={[{ marginBottom: 12 }, estiloContenedor]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <TextInput {...props} value={value} onChangeText={onChangeText} style={[e.input, style, { flex: 1, minWidth: 0, marginBottom: 0, marginTop: 0 }]} />
        <Pressable
          onPress={() => void alternar()}
          accessibilityRole="button"
          accessibilityLabel={oyendo ? 'Dejar de dictar' : 'Dictar con el micrófono'}
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: oyendo ? colores.asistencia : colores.primarioSuave }}
        >
          <Text style={{ fontSize: 20, color: oyendo ? colores.blanco : colores.primario }}>🎙</Text>
        </Pressable>
      </View>
      {oyendo && <Text style={[e.suave, { color: colores.asistencia, marginTop: 4 }]}>Escuchando… habla y lo escribimos. Toca otra vez para terminar.</Text>}
      {aviso && <Text style={[e.suave, { color: colores.aviso, marginTop: 4 }]}>{aviso}</Text>}
    </View>
  );
}
