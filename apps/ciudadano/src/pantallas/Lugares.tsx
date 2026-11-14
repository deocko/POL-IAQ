import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import {
  ETIQUETAS_VULNERABILIDAD, MAX_LUGARES, TIPOS_LUGAR, VULNERABILIDADES, incidentePorId, sugerirEscenarios,
  type LugarGuardado, type Perfil, type TipoLugar, type Vulnerabilidad,
} from '@pol-iaq/shared/movil';
import { api } from '../api';
import { CampoDictado } from '../componentes/CampoDictado';
import { colores, e } from '../estilos';
import { ubicacionActual } from '../ubicacion';

const ETIQUETA_TIPO: Record<TipoLugar, string> = { casa: 'Mi casa', familiar: 'Familiar', trabajo: 'Trabajo', escuela: 'Escuela', otro: 'Otro' };

function nuevoId(nombre: string) {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'lugar';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Mis lugares: casa, casa de los abuelos, trabajo… Cada lugar guarda su
 * ubicación exacta y genera escenarios de acceso rápido que aparecen en el
 * inicio. La información médica es opcional y solo se comparte al reportar.
 */
export function Lugares({ token, perfil, alCambiar, alSalir }: { token: string; perfil: Perfil; alCambiar: (p: Perfil) => void; alSalir: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoLugar>('casa');
  const [referencia, setReferencia] = useState('');
  const [vulnerables, setVulnerables] = useState<Vulnerabilidad[]>([]);
  const [infoMedica, setInfoMedica] = useState('');
  const [punto, setPunto] = useState<{ lat: number; lng: number } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(p: Perfil) {
    setGuardando(true);
    try {
      alCambiar(await api.guardarPerfil(token, p));
    } catch {
      Alert.alert('No se guardó', 'Revisa tu conexión e intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function agregar() {
    if (!nombre.trim() || !punto) return;
    const lugar: LugarGuardado = {
      id: nuevoId(nombre),
      nombre: nombre.trim(),
      tipo,
      ubicacion: { ...punto, ...(referencia.trim() && { referencia: referencia.trim() }) },
      vulnerables,
      ...(infoMedica.trim() && { infoMedica: infoMedica.trim() }),
    };
    await guardar({ lugares: [...perfil.lugares, lugar], escenarios: [...perfil.escenarios, ...sugerirEscenarios(lugar)] });
    setEditando(false);
    setNombre(''); setReferencia(''); setVulnerables([]); setInfoMedica(''); setPunto(null);
  }

  function quitarLugar(id: string) {
    Alert.alert('Quitar lugar', 'Se borrarán también sus accesos rápidos.', [
      { text: 'Cancelar' },
      { text: 'Quitar', style: 'destructive', onPress: () => void guardar({ lugares: perfil.lugares.filter((l) => l.id !== id), escenarios: perfil.escenarios.filter((x) => x.lugarId !== id) }) },
    ]);
  }

  function quitarEscenario(id: string) {
    void guardar({ ...perfil, escenarios: perfil.escenarios.filter((x) => x.id !== id) });
  }

  function restaurarSugeridos(l: LugarGuardado) {
    const existentes = new Set(perfil.escenarios.map((x) => x.id));
    void guardar({ ...perfil, escenarios: [...perfil.escenarios, ...sugerirEscenarios(l).filter((x) => !existentes.has(x.id))] });
  }

  return (
    <ScrollView style={e.pantalla} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={e.titulo}>Mis lugares</Text>
      <Text style={e.suave}>Guarda los lugares donde podrías necesitar ayuda. Para cada uno preparamos botones de acceso rápido que envían la ubicación exacta y las respuestas que ya conocemos.</Text>

      {perfil.lugares.map((l) => (
        <View key={l.id} style={[e.tarjeta, { marginTop: 12 }]}>
          <View style={e.fila}>
            <View style={{ flex: 1 }}>
              <Text style={[e.texto, { fontWeight: '700' }]}>{l.nombre}</Text>
              <Text style={e.suave}>{ETIQUETA_TIPO[l.tipo]}{l.ubicacion.referencia ? ` · ${l.ubicacion.referencia}` : ''}</Text>
              {l.vulnerables.length > 0 && <Text style={e.suave}>{l.vulnerables.map((v) => ETIQUETAS_VULNERABILIDAD[v]).join(', ')}</Text>}
            </View>
            <Pressable onPress={() => quitarLugar(l.id)}><Text style={{ color: colores.asistencia }}>Quitar</Text></Pressable>
          </View>
          {perfil.escenarios.filter((x) => x.lugarId === l.id).map((x) => (
            <View key={x.id} style={[e.fila, { marginTop: 8, backgroundColor: colores.primarioSuave, borderRadius: 8, padding: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[e.texto, { fontWeight: '600' }]}>{x.titulo}</Text>
                <Text style={e.suave}>{incidentePorId(x.incidenteId)?.nombreCiudadano}</Text>
              </View>
              <Pressable onPress={() => quitarEscenario(x.id)} accessibilityLabel={`Quitar ${x.titulo}`}><Text style={e.suave}>✕</Text></Pressable>
            </View>
          ))}
          <Pressable onPress={() => restaurarSugeridos(l)} style={{ marginTop: 8 }}><Text style={{ color: colores.primario }}>Restaurar accesos sugeridos</Text></Pressable>
        </View>
      ))}

      {editando ? (
        <View style={[e.tarjeta, { marginTop: 12 }]}>
          <Text style={e.subtitulo}>Nuevo lugar</Text>
          <CampoDictado placeholder="Nombre, ej. Casa de mis abuelos" value={nombre} onChangeText={setNombre} maxLength={60} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {TIPOS_LUGAR.map((t) => (
              <Pressable key={t} style={[e.chip, tipo === t && e.chipActivo]} onPress={() => setTipo(t)}><Text>{ETIQUETA_TIPO[t]}</Text></Pressable>
            ))}
          </View>
          <Pressable style={e.botonSecundario} onPress={async () => { const u = await ubicacionActual(); if (u) setPunto({ lat: u.lat, lng: u.lng }); }}>
            <Text style={e.botonSecundarioTexto}>{punto ? `Ubicación guardada (${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)})` : 'Usar mi ubicación actual (estando en el lugar)'}</Text>
          </Pressable>
          <CampoDictado estiloContenedor={{ marginTop: 12 }} placeholder="Referencia: calle, número, color de fachada" value={referencia} onChangeText={setReferencia} maxLength={280} multiline />
          <Text style={e.suave}>¿Quién vive ahí y necesita atención especial?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
            {VULNERABILIDADES.map((v) => (
              <Pressable key={v} style={[e.chip, vulnerables.includes(v) && e.chipActivo]} onPress={() => setVulnerables((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]))}>
                <Text>{ETIQUETAS_VULNERABILIDAD[v]}</Text>
              </Pressable>
            ))}
          </View>
          <CampoDictado placeholder="Información médica (opcional), ej. abuelo diabético" value={infoMedica} onChangeText={setInfoMedica} maxLength={280} multiline />
          <Text style={[e.suave, { marginBottom: 8 }]}>Dato sensible: solo se envía a la corporación cuando usas un acceso rápido de este lugar.</Text>
          <Pressable style={[e.boton, (!nombre.trim() || !punto || guardando) && { opacity: 0.5 }]} disabled={!nombre.trim() || !punto || guardando} onPress={agregar}>
            <Text style={e.botonTexto}>Guardar lugar y crear accesos rápidos</Text>
          </Pressable>
          <Pressable style={e.botonSecundario} onPress={() => setEditando(false)}><Text style={e.botonSecundarioTexto}>Cancelar</Text></Pressable>
        </View>
      ) : (
        perfil.lugares.length < MAX_LUGARES && (
          <Pressable style={[e.boton, { marginTop: 12 }]} onPress={() => setEditando(true)}><Text style={e.botonTexto}>Agregar lugar</Text></Pressable>
        )
      )}
      <Pressable style={e.botonSecundario} onPress={alSalir}><Text style={e.botonSecundarioTexto}>Volver al inicio</Text></Pressable>
    </ScrollView>
  );
}
