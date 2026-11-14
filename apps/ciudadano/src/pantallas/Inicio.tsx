import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { referenciaDeLugar, respuestasDe, preguntasHechas, type Escenario, type Perfil } from '@pol-iaq/shared/movil';
import { api, type IncidenteCatalogoPublico, type ReporteVista } from '../api';
import { colores, e } from '../estilos';
import { avisarFallo, ubicacionActual } from '../ubicacion';
import type { ContinuarReporte } from './Asistente911';

/**
 * Pantalla principal: botón de asistencia directa, despachadora 911 virtual,
 * accesos rápidos de mis lugares y catálogo en lenguaje simple.
 */
export function Inicio({
  token, perfil, alCrear, alAsistente, alLugares,
}: {
  token: string;
  perfil: Perfil;
  alCrear: (folio: string) => void;
  alAsistente: (continuar?: ContinuarReporte) => void;
  alLugares: () => void;
}) {
  const [catalogo, setCatalogo] = useState<IncidenteCatalogoPublico[]>([]);
  const [enviando, setEnviando] = useState(false);
  /** Escenario "armado": el segundo toque en 4 s lo envía (evita reportes por toques accidentales). */
  const [armado, setArmado] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.catalogo().then((c) => setCatalogo(c.incidentes)).catch(() => Alert.alert('Sin conexión', 'No pudimos cargar el catálogo. Si es urgente, llama al 911.'));
    return () => clearTimeout(temporizador.current);
  }, []);

  /** Tras crear el folio, la despachadora pregunta lo que falte; si no falta nada, al seguimiento. */
  function despues(r: ReporteVista) {
    if (r.cuestionario.pendientes.length) alAsistente({ folio: r.folio, incidenteId: r.incidenteId, respuestas: respuestasDe(r.cuestionario.entradas), accesoRapido: !!r.escenarioId, yaHechas: preguntasHechas(r.cuestionario.entradas) });
    else alCrear(r.folio);
  }

  async function reportar(incidenteId: string, asistenciaDirecta = false) {
    setEnviando(true);
    try {
      const ubicacion = await ubicacionActual();
      if (!ubicacion) return;
      const r = await api.crearReporte(token, { incidenteId, asistenciaDirecta, ubicacion });
      despues(r);
    } catch {
      avisarFallo();
    } finally {
      setEnviando(false);
    }
  }

  async function activarEscenario(x: Escenario) {
    if (armado !== x.id) {
      setArmado(x.id);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setArmado(null), 4000);
      return;
    }
    setArmado(null);
    const lugar = perfil.lugares.find((l) => l.id === x.lugarId);
    if (!lugar) return;
    setEnviando(true);
    try {
      const r = await api.crearReporte(token, {
        incidenteId: x.incidenteId,
        escenarioId: x.id,
        descripcion: x.descripcion,
        ubicacion: { lat: lugar.ubicacion.lat, lng: lugar.ubicacion.lng, referencia: referenciaDeLugar(lugar) },
      });
      despues(r);
    } catch {
      avisarFallo();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ScrollView style={e.pantalla} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={e.titulo}>¿Qué está pasando?</Text>
      <Pressable
        style={{ backgroundColor: colores.asistencia, borderRadius: 16, padding: 22, alignItems: 'center', marginVertical: 12, shadowColor: colores.asistencia, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
        onLongPress={() => reportar('otro', true)}
        delayLongPress={800}
        disabled={enviando}
        accessibilityLabel="Botón de asistencia directa: mantén presionado para pedir una unidad"
      >
        <Text style={{ color: colores.blanco, fontSize: 21, fontWeight: '800', textAlign: 'center' }}>BOTÓN DE ASISTENCIA DIRECTA</Text>
        <Text style={{ color: colores.blanco, marginTop: 4, textAlign: 'center' }}>Mantén presionado para enviar tu ubicación y pedir una unidad</Text>
      </Pressable>
      {enviando && <ActivityIndicator size="large" style={{ marginVertical: 12 }} />}

      <Pressable style={[e.tarjeta, { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colores.primarioSuave, borderColor: colores.primarioSuave }]} onPress={() => alAsistente()} disabled={enviando}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colores.blanco, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 20 }}>🎧</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[e.texto, { fontWeight: '700', color: colores.primario }]}>Hablar con la despachadora 911 virtual</Text>
          <Text style={e.suave}>Por voz o por texto. Te hace las preguntas del protocolo y canaliza la unidad.</Text>
        </View>
      </Pressable>

      <View style={[e.fila, { marginTop: 8 }]}>
        <Text style={[e.subtitulo, { flex: 1 }]}>Mis accesos rápidos</Text>
        <Pressable onPress={alLugares}><Text style={{ color: colores.primario, fontWeight: '600' }}>{perfil.lugares.length ? 'Mis lugares' : 'Agregar lugar'}</Text></Pressable>
      </View>
      {!perfil.escenarios.length && (
        <Pressable style={e.tarjeta} onPress={alLugares}>
          <Text style={e.texto}>Guarda tu casa, la de tus familiares o tu trabajo y prepararemos botones para emergencias como una emergencia médica de tus abuelos o ruidos extraños de noche.</Text>
        </Pressable>
      )}
      {perfil.lugares.map((l) => {
        const lista = perfil.escenarios.filter((x) => x.lugarId === l.id);
        if (!lista.length) return null;
        return (
          <View key={l.id} style={{ marginBottom: 8 }}>
            <Text style={[e.suave, { marginBottom: 6 }]}>{l.nombre}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {lista.map((x) => {
                const listo = armado === x.id;
                return (
                  <Pressable
                    key={x.id}
                    disabled={enviando}
                    onPress={() => activarEscenario(x)}
                    style={{ flexBasis: '48%', flexGrow: 1, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: listo ? colores.asistencia : colores.borde, backgroundColor: listo ? colores.asistenciaSuave : colores.tarjeta }}
                  >
                    <Text style={[e.texto, { fontWeight: '600' }]}>{x.titulo}</Text>
                    <Text style={[e.suave, listo && { color: colores.asistencia, fontWeight: '700' }]}>{listo ? 'Toca otra vez para enviar' : 'Ubicación exacta guardada'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      <Text style={e.subtitulo}>O elige el tipo de emergencia</Text>
      {catalogo.map((i) => (
        <Pressable key={i.id} style={e.tarjeta} disabled={enviando} onPress={() => reportar(i.id)}>
          <View style={e.fila}>
            <Text style={[e.texto, { flex: 1, fontWeight: '600' }]}>{i.nombreCiudadano}</Text>
            {i.prioridad === 'alta' && <Text style={[e.suave, { color: colores.asistencia }]}>Urgente</Text>}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
