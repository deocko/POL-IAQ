import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ESTADOS_FINALES, ETIQUETAS_CIUDADANO, type EstadoIncidente } from '@pol-iaq/shared/movil';
import { api, seguir, type ReporteVista } from '../api';
import { MapaSeguimiento } from '../componentes/MapaSeguimiento';
import type { Punto } from '../componentes/tipos-mapa';
import { tomarYSubirFoto } from '../evidencia';
import { colores, e } from '../estilos';

const PASOS: EstadoIncidente[] = ['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado'];
const MAX_RECORRIDO = 60;

/**
 * Seguimiento tipo app de entregas: mapa con la unidad en vivo, pasos,
 * tiempo estimado y chat con el operador, todo bajo el folio unificado.
 */
export function Seguimiento({ token, folio, alSalir }: { token: string; folio: string; alSalir: () => void }) {
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
