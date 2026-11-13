import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ESTADOS_FINALES, ETIQUETAS_CIUDADANO, respuestasDe, type EstadoIncidente } from '@pol-iaq/shared/movil';
import { api, seguir, type ReporteVista } from '../api';
import { MapaSeguimiento } from '../componentes/MapaSeguimiento';
import type { Punto } from '../componentes/tipos-mapa';
import { tomarYSubirFoto } from '../evidencia';
import { colores, e } from '../estilos';
import type { ContinuarReporte } from './Asistente911';

const PASOS: EstadoIncidente[] = ['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado'];
const MAX_RECORRIDO = 60;

/**
 * Seguimiento tipo app de entregas: mapa con la unidad en vivo, pasos,
 * tiempo estimado y chat con el operador, todo bajo el folio unificado.
 */
export function Seguimiento({ token, folio, alSalir, alContinuar }: { token: string; folio: string; alSalir: () => void; alContinuar: (c: ContinuarReporte) => void }) {
  const [r, setR] = useState<ReporteVista | null>(null);
  const [texto, setTexto] = useState('');
  const [recorrido, setRecorrido] = useState<Punto[]>([]);
  const unidadDelRecorrido = useRef<string | null>(null);

  // Acumula las posiciones que llegan por el socket para dibujar el trayecto.
  const u = r?.unidad;
  useEffect(() => {
    if (!u || u.lat === undefined || u.lng === undefined) return;
    if (unidadDelRecorrido.current !== u.etiqueta) {
      unidadDelRecorrido.current = u.etiqueta;
      setRecorrido([{ lat: u.lat, lng: u.lng }]);
      return;
    }
    setRecorrido((prev) => {
      const ultimo = prev.at(-1);
      if (ultimo && ultimo.lat === u.lat && ultimo.lng === u.lng) return prev;
      return [...prev, { lat: u.lat!, lng: u.lng! }].slice(-MAX_RECORRIDO);
    });
  }, [u?.etiqueta, u?.lat, u?.lng]);

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

      {!finalizado && (
        <MapaSeguimiento
          reporte={r.ubicacion}
          unidad={r.unidad && r.unidad.lat !== undefined && r.unidad.lng !== undefined ? { lat: r.unidad.lat, lng: r.unidad.lng, rumbo: r.unidad.rumbo, etiqueta: r.unidad.etiqueta } : undefined}
          recorrido={recorrido}
        />
      )}

      {r.unidad && (
        <View style={[e.tarjeta, { marginTop: 12 }]}>
          <Text style={[e.texto, { fontWeight: '600' }]}>{r.unidad.etiqueta}</Text>
          {r.unidad.etaMinutos !== undefined && r.estado === 'en_camino' && <Text style={e.texto}>Llega en unos {Math.round(r.unidad.etaMinutos)} min</Text>}
          {r.unidad.lat === undefined && !finalizado && <Text style={e.suave}>Esperando la ubicación de la unidad…</Text>}
          {r.unidad.actualizadoEn && !finalizado && <Text style={e.suave}>Ubicación actualizada a las {new Date(r.unidad.actualizadoEn).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>}
        </View>
      )}

      {r.canalizacion.alertas.length > 0 && (
        <View style={[e.tarjeta, { backgroundColor: colores.asistenciaSuave, borderColor: colores.asistenciaSuave }]}>
          <Text style={[e.suave, { color: colores.asistencia, fontWeight: '700' }]}>La unidad va enterada de:</Text>
          <Text style={e.texto}>{r.canalizacion.alertas.join(' · ')}</Text>
        </View>
      )}

      {!finalizado && r.cuestionario.pendientes.length > 0 && (
        <Pressable style={e.boton} onPress={() => alContinuar({ folio: r.folio, incidenteId: r.incidenteId, respuestas: respuestasDe(r.cuestionario.entradas) })}>
          <Text style={e.botonTexto}>Contestar {r.cuestionario.pendientes.length} preguntas con la despachadora</Text>
        </Pressable>
      )}

      {!finalizado && r.recomendaciones.length > 0 && (
        <>
          <Text style={e.subtitulo}>Mientras llega la unidad</Text>
          {r.recomendaciones.map((t) => <Text key={t} style={[e.texto, { marginBottom: 4 }]}>• {t}</Text>)}
        </>
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

      {r.cuestionario.entradas.length > 0 && (
        <>
          <Text style={e.subtitulo}>Tus respuestas (quedan en el folio)</Text>
          <View style={e.tarjeta}>
            {r.cuestionario.entradas.map((x) => (
              <View key={`${x.preguntaId}-${x.en}`} style={{ marginBottom: 8 }}>
                <Text style={e.suave}>{x.pregunta}</Text>
                <Text style={e.texto}>{x.respuestaTexto}</Text>
              </View>
            ))}
            <Text style={e.suave}>Protocolo {r.cuestionario.protocoloVersion}{r.cuestionario.protocoloEstado === 'provisional' ? ' (provisional)' : ''}</Text>
          </View>
        </>
      )}

      <Text style={e.subtitulo}>Mensajes</Text>
      {r.mensajes.map((m) => (
        <View key={m.id} style={[e.tarjeta, m.autor === 'ciudadano' && { backgroundColor: colores.primarioSuave }]}>
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
