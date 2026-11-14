import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import {
  CATALOGO_SEMILLA, NO_SABE, clasificarRelato, incidentePorId, interpretarRespuesta, preguntasDespachadora, protocoloDe,
  type EntradaCuestionario, type PreguntaProtocolo, type Protocolo, type ValorRespuesta, type ViaCuestionario,
} from '@pol-iaq/shared/movil';
import { ErrorApi, api, type ReporteVista } from '../api';
import { CampoDictado, hayDictadoEnCurso } from '../componentes/CampoDictado';
import { colores, e } from '../estilos';
import { avisarFallo, llamar911, ubicacionActual } from '../ubicacion';

type Fase = 'motivo' | 'confirmar' | 'elegir' | 'enviando' | 'pregunta' | 'fin';
interface Burbuja { id: number; de: 'despachadora' | 'yo'; texto: string }

/** Reporte ya levantado (desde un escenario o desde el seguimiento) cuyas preguntas faltan. */
export interface ContinuarReporte {
  folio: string;
  incidenteId: string;
  respuestas: Record<string, ValorRespuesta>;
  /** Vino de un acceso rápido: sus respuestas ya van prellenadas y se pregunta lo mínimo. */
  accesoRapido?: boolean;
  /** Preguntas que la persona ya contestó en este folio (cuentan para el tope). */
  yaHechas?: number;
}

const SI_NO: PreguntaProtocolo = { id: 'confirmacion', texto: '', tipo: 'si_no', obligatoria: true, efectos: [] };

/**
 * Despachadora 911 virtual. Conduce la llamada según el protocolo de atención
 * vigente: pregunta el motivo, lo clasifica en el catálogo, levanta el folio
 * en cuanto sabe qué pasa (para no retrasar el despacho) y después hace solo
 * las preguntas indispensables del protocolo (`preguntasDespachadora`): pocas en
 * un tema nuevo y casi ninguna si viene de un acceso rápido. Nunca repite una
 * pregunta y la persona puede terminar cuando quiera. Cada respuesta se guarda en texto en el folio y
 * recalcula la canalización de la unidad.
 *
 * Funciona por voz (lee en voz alta y escucha) o por texto, y siempre ofrece
 * marcar al 911 real.
 */
export function Asistente911({
  token, protocolo, continuar, alTerminar, alSalir,
}: {
  token: string;
  protocolo: Protocolo;
  continuar?: ContinuarReporte;
  alTerminar: (folio: string) => void;
  alSalir: () => void;
}) {
  const [burbujas, setBurbujas] = useState<Burbuja[]>([]);
  const [fase, setFase] = useState<Fase>('motivo');
  const [pregunta, setPregunta] = useState<PreguntaProtocolo | null>(null);
  const [texto, setTexto] = useState('');
  const [voz, setVoz] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const contador = useRef(0);

  // Estado de la llamada en refs: los eventos de voz llegan fuera del render.
  const s = useRef({
    fase: 'motivo' as Fase,
    relato: '',
    propuesta: null as string | null,
    incidenteId: continuar?.incidenteId ?? null,
    folio: continuar?.folio ?? null,
    respuestas: { ...(continuar?.respuestas ?? {}) } as Record<string, ValorRespuesta>,
    omitidas: new Set<string>(),
    /** Preguntas ya hechas en esta llamada: nunca se repiten aunque no se haya podido guardar la respuesta. */
    hechas: new Set<string>(),
    yaHechas: continuar?.yaHechas ?? 0,
    noEntendi: 0,
    /** Respuestas que no se pudieron enviar; viajan con la siguiente. */
    porEnviar: [] as { via: ViaCuestionario; entrada: EntradaCuestionario }[],
    pregunta: null as PreguntaProtocolo | null,
    voz: false,
  });

  function cambiarFase(f: Fase) {
    s.current.fase = f;
    setFase(f);
  }

  function decir(t: string, esperaRespuesta = false) {
    setBurbujas((b) => [...b, { id: ++contador.current, de: 'despachadora', texto: t }]);
    if (s.current.voz) {
      Speech.speak(t, { language: 'es-MX', rate: 1.0, onDone: () => {
        if (esperaRespuesta) escuchar();
      } });
    }
  }

  function escuchar() {
    if (!s.current.voz) return;
    try {
      ExpoSpeechRecognitionModule.start({ lang: 'es-MX', interimResults: false, continuous: false });
      setEscuchando(true);
    } catch {
      setAviso('No pudimos usar el micrófono. Escribe tu respuesta.');
    }
  }

  useSpeechRecognitionEvent('result', (ev) => {
    // Un dictado en el campo de texto no es la llamada por voz.
    if (!ev.isFinal || hayDictadoEnCurso()) return;
    const dicho = ev.results[0]?.transcript?.trim();
    if (dicho) void recibir(dicho, 'voz');
  });
  useSpeechRecognitionEvent('end', () => setEscuchando(false));
  useSpeechRecognitionEvent('error', () => {
    setEscuchando(false);
    if (hayDictadoEnCurso()) return;
    setAviso('No te escuché bien. Toca el micrófono o escribe.');
  });

  async function activarVoz(activa: boolean) {
    setAviso(null);
    if (activa) {
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!p.granted) {
        setAviso('Sin permiso de micrófono: seguimos por texto.');
        return;
      }
    } else {
      Speech.stop();
      ExpoSpeechRecognitionModule.abort();
      setEscuchando(false);
    }
    s.current.voz = activa;
    setVoz(activa);
    if (activa && s.current.fase !== 'fin') escuchar();
  }

  useEffect(() => {
    decir(protocolo.apertura.saludo);
    if (continuar) {
      decir(`Continuamos con su folio ${continuar.folio}. Le haré las preguntas que faltan para enviar la ayuda adecuada.`);
      siguiente();
    } else {
      decir(protocolo.apertura.preguntaMotivo, true);
    }
    return () => {
      Speech.stop();
      ExpoSpeechRecognitionModule.abort();
    };
    // Solo al abrir la llamada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function recibir(dicho: string, via: ViaCuestionario) {
    setAviso(null);
    setBurbujas((b) => [...b, { id: ++contador.current, de: 'yo', texto: dicho }]);
    const st = s.current;
    switch (st.fase) {
      case 'motivo': {
        st.relato = dicho;
        const top = clasificarRelato(protocolo, dicho)[0];
        if (top) {
          st.propuesta = top.incidenteId;
          cambiarFase('confirmar');
          decir(protocolo.apertura.confirmacion.replace('{incidente}', incidentePorId(top.incidenteId)?.nombreCiudadano ?? top.incidenteId), true);
        } else {
          cambiarFase('elegir');
          decir('No logré identificar el tipo de emergencia. Elija la opción que más se parezca, o descríbala con otras palabras.', true);
        }
        return;
      }
      case 'confirmar': {
        const v = interpretarRespuesta(SI_NO, dicho);
        if (v === true && st.propuesta) return void levantar(st.propuesta);
        if (v === false || v === NO_SABE) {
          cambiarFase('elegir');
          return decir('De acuerdo. Elija la opción que más se parezca a su emergencia.', true);
        }
        return decir('Perdone, no le entendí. ¿Es correcto? Responda sí o no.', true);
      }
      case 'elegir': {
        const top = clasificarRelato(protocolo, dicho)[0];
        if (top) return void levantar(top.incidenteId);
        return decir('Sigo sin identificarla. Toque la opción más parecida o "Otra emergencia".', true);
      }
      case 'pregunta': {
        const q = st.pregunta;
        if (!q) return;
        const v = interpretarRespuesta(q, dicho);
        if (v === undefined) {
          // A la segunda se anota "No sabe" y se sigue: la llamada no se atora en una pregunta.
          if (++st.noEntendi < 2) return decir(`Perdone, no le entendí. ${q.texto}${q.tipo === 'si_no' ? ' Diga sí o no.' : ''}`, true);
          decir('Lo anoto como "no sabe".');
          await guardar(q, NO_SABE, dicho, via);
          return;
        }
        await guardar(q, v, dicho, via);
        return;
      }
      default:
        return;
    }
  }

  /** Levanta el folio en cuanto se sabe qué pasa; las preguntas siguen después. */
  async function levantar(incidenteId: string) {
    const st = s.current;
    st.incidenteId = incidenteId;
    cambiarFase('enviando');
    decir('Estoy enviando su reporte con su ubicación exacta. No cuelgue.');
    try {
      const ubicacion = await ubicacionActual();
      if (!ubicacion) return alSalir();
      const r = await api.crearReporte(token, { incidenteId, ubicacion, descripcion: st.relato || undefined });
      st.folio = r.folio;
      decir(`Su folio es ${r.folio}. Ya se solicitó una unidad. Le haré unas preguntas rápidas; puede terminar cuando quiera.`);
      siguiente();
    } catch {
      avisarFallo();
      cambiarFase('elegir');
    }
  }

  async function guardar(q: PreguntaProtocolo, valor: ValorRespuesta, textoOriginal: string | undefined, via: ViaCuestionario) {
    const st = s.current;
    st.respuestas[q.id] = valor;
    st.hechas.add(q.id);
    st.noEntendi = 0;
    st.porEnviar.push({ via, entrada: { preguntaId: q.id, respuesta: valor, textoOriginal } });
    // Se agrupan por vía (voz/texto) para que el folio registre cómo se respondió cada una.
    for (const v of ['voz', 'texto'] as const) {
      const lote = st.porEnviar.filter((x) => x.via === v);
      if (!lote.length) continue;
      try {
        await api.responder(token, st.folio!, v, lote.map((x) => x.entrada));
        st.porEnviar = st.porEnviar.filter((x) => !lote.includes(x));
      } catch (err) {
        if (err instanceof ErrorApi && err.status === 409) {
          // El reporte ya se cerró: no tiene caso seguir preguntando.
          st.porEnviar = [];
          return terminar('Su reporte ya fue atendido o cerrado.');
        }
        setAviso('No se guardó la última respuesta; la volveremos a enviar con la siguiente.');
      }
    }
    siguiente();
  }

  function omitir() {
    const q = s.current.pregunta;
    if (!q || q.obligatoria) return;
    s.current.omitidas.add(q.id);
    setBurbujas((b) => [...b, { id: ++contador.current, de: 'yo', texto: '(Omitir)' }]);
    siguiente();
  }

  function siguiente() {
    const st = s.current;
    const vistas = { ...st.respuestas };
    for (const id of st.omitidas) vistas[id] = '';
    const q = preguntasDespachadora(protocolo, st.incidenteId!, vistas, { accesoRapido: continuar?.accesoRapido, yaHechas: st.yaHechas + st.hechas.size })
      .find((x) => !st.hechas.has(x.id));
    st.pregunta = q ?? null;
    setPregunta(q ?? null);
    if (q) {
      cambiarFase('pregunta');
      decir(q.texto, true);
      return;
    }
    terminar();
  }

  function terminar(nota?: string) {
    const st = s.current;
    st.pregunta = null;
    setPregunta(null);
    cambiarFase('fin');
    if (nota) decir(nota);
    decir(protocolo.apertura.cierre.replace('{folio}', st.folio ?? ''));
    for (const r of protocoloDe(protocolo, st.incidenteId!)?.recomendaciones ?? []) decir(r);
  }

  function enviarTexto() {
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    void recibir(t, 'texto');
  }

  /** Botones de respuesta rápida según el tipo de pregunta. */
  function rapidas(): { etiqueta: string; accion: () => void }[] {
    if (fase === 'confirmar') return [{ etiqueta: 'Sí, es correcto', accion: () => void recibir('sí', 'texto') }, { etiqueta: 'No', accion: () => void recibir('no', 'texto') }];
    if (fase === 'elegir') return CATALOGO_SEMILLA.map((i) => ({ etiqueta: i.nombreCiudadano, accion: () => { setBurbujas((b) => [...b, { id: ++contador.current, de: 'yo', texto: i.nombreCiudadano }]); void levantar(i.id); } }));
    if (fase !== 'pregunta' || !pregunta) return [];
    const q = pregunta;
    const resp = (etiqueta: string, v: ValorRespuesta) => ({ etiqueta, accion: () => { setBurbujas((b) => [...b, { id: ++contador.current, de: 'yo', texto: etiqueta }]); void guardar(q, v, undefined, 'texto'); } });
    const lista =
      q.tipo === 'si_no' ? [resp('Sí', true), resp('No', false)]
      : q.tipo === 'opcion' ? (q.opciones ?? []).map((o) => resp(o.etiqueta, o.valor))
      : [];
    if (q.tipo !== 'texto') lista.push(resp('No sé', NO_SABE));
    if (!q.obligatoria) lista.push({ etiqueta: 'Omitir', accion: omitir });
    lista.push({ etiqueta: 'Terminar, ya pedí ayuda', accion: () => { setBurbujas((b) => [...b, { id: ++contador.current, de: 'yo', texto: 'Terminar' }]); terminar(); } });
    return lista;
  }

  const ocupado = fase === 'enviando';
  /** Respuesta libre: el relato inicial o una pregunta de texto del protocolo. */
  const abierta = fase === 'motivo' || fase === 'elegir' || (fase === 'pregunta' && pregunta?.tipo === 'texto');

  return (
    <View style={[e.pantalla, { paddingBottom: 0 }]}>
      <View style={[e.tarjeta, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colores.primarioSuave, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colores.primario }}>911</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[e.texto, { fontWeight: '700' }]}>Despachadora 911 virtual</Text>
          <Text style={e.suave}>{escuchando ? 'Escuchando…' : voz ? 'Llamada por voz' : 'Atención por texto'} · Protocolo {protocolo.version}</Text>
        </View>
        <Pressable onPress={llamar911} style={[e.chip, { borderColor: colores.asistencia }]} accessibilityLabel="Llamar al 911 real">
          <Text style={{ color: colores.asistencia, fontWeight: '700' }}>Llamar 911</Text>
        </Pressable>
      </View>
      {protocolo.estado !== 'vigente' && (
        <Text style={[e.suave, { backgroundColor: colores.avisoSuave, color: colores.aviso, padding: 8, borderRadius: 8, marginBottom: 8 }]}>
          Protocolo provisional en validación. Si la situación empeora, llama al 911.
        </Text>
      )}

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12, gap: 8 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {burbujas.map((b) => (
          <View key={b.id} style={{ alignSelf: b.de === 'yo' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: b.de === 'yo' ? colores.primario : colores.despachadora, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 }}>
            <Text style={[e.texto, b.de === 'yo' && { color: colores.blanco }]}>{b.texto}</Text>
          </View>
        ))}
        {ocupado && <ActivityIndicator style={{ marginTop: 8 }} />}
      </ScrollView>

      {aviso && <Text style={[e.suave, { color: colores.aviso, marginBottom: 4 }]}>{aviso}</Text>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {rapidas().map((r) => (
          <Pressable key={r.etiqueta} style={e.chip} onPress={r.accion} disabled={ocupado}>
            <Text style={{ color: colores.texto }}>{r.etiqueta}</Text>
          </Pressable>
        ))}
      </View>

      {fase === 'fin' ? (
        <Pressable style={[e.boton, { marginBottom: 24 }]} onPress={() => alTerminar(s.current.folio!)}>
          <Text style={e.botonTexto}>Ver mi unidad en el mapa</Text>
        </Pressable>
      ) : (
        <View style={[e.fila, { marginBottom: 24 }]}>
          <Pressable
            onPress={() => (voz ? (escuchando ? ExpoSpeechRecognitionModule.stop() : escuchar()) : void activarVoz(true))}
            onLongPress={() => void activarVoz(false)}
            style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: escuchando ? colores.asistencia : voz ? colores.primario : colores.primarioSuave }}
            accessibilityLabel={voz ? 'Micrófono: toca para hablar, mantén presionado para pasar a texto' : 'Hablar por voz con la despachadora'}
          >
            <Text style={{ fontSize: 22, color: voz ? colores.blanco : colores.primario }}>🎙</Text>
          </Pressable>
          {abierta && !voz ? (
            // Pregunta abierta: se puede dictar al campo y revisar antes de enviar.
            <CampoDictado
              estiloContenedor={{ flex: 1, minWidth: 0, marginBottom: 0 }}
              placeholder="Escribe o dicta tu respuesta"
              value={texto}
              onChangeText={setTexto}
              onSubmitEditing={enviarTexto}
              editable={!ocupado}
            />
          ) : (
            <TextInput
              style={[e.input, { flex: 1, minWidth: 0, marginBottom: 0 }]}
              placeholder={pregunta?.tipo === 'numero' ? 'Escribe un número' : 'Escribe tu respuesta'}
              keyboardType={pregunta?.tipo === 'numero' ? 'number-pad' : 'default'}
              value={texto}
              onChangeText={setTexto}
              onSubmitEditing={enviarTexto}
              editable={!ocupado}
            />
          )}
          <Pressable style={[e.boton, { marginTop: 0, paddingHorizontal: 16 }]} onPress={enviarTexto} disabled={ocupado}>
            <Text style={e.botonTexto}>Enviar</Text>
          </Pressable>
        </View>
      )}
      {fase !== 'fin' && !s.current.folio && (
        <Pressable onPress={alSalir} style={{ alignSelf: 'center', marginBottom: 16 }}>
          <Text style={e.suave}>Salir sin reportar</Text>
        </Pressable>
      )}
    </View>
  );
}
