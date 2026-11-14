'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../consola/consola.css';
import './demo.css';
import {
  ESPERA_ANTES_DE_911_SEG, debeOfrecer911, duracionTexto, encolar, vaciarCola,
  type Identidad, type Opinion, type PendienteEnvio,
} from '@pol-iaq/shared/movil';
import { AVISO_DEMO, CODIGO_SMS_DEMO } from '../../lib/demo/textos';
import * as demo from '../../lib/demo/motor';
import type { EvidenciaDemo, NuevoReporte as DatosReporte, ReporteDemo } from '../../lib/demo/motor';
import { Mapa } from '../../lib/mapa/Mapa';
import { SelectorTema } from '../../lib/tema';

type Respuesta = string | number | boolean;
type Foto = Omit<EvidenciaDemo, 'id'>;
interface Ciudadano { nombre: string; telefono: string }

const CLAVE_CIUDADANO = 'poliaq.demo.ciudadano';
const CLAVE_FOLIO = 'poliaq.demo.folio';
const CLAVE_COLA = 'poliaq.demo.cola';
const FINALES = ['cerrado', 'improcedente', 'cancelado'];
const MAX_FOTOS = 3;

function leerLocal<T>(clave: string): T | null {
  try { const t = localStorage.getItem(clave); return t ? (JSON.parse(t) as T) : null; } catch { return null; }
}
function guardarLocal(clave: string, v: unknown) {
  try { if (v === null) localStorage.removeItem(clave); else localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

/** Conexión real del navegador, más un interruptor para simularla en la demo. */
function useConexion() {
  const [navegador, setNavegador] = useState(true);
  const [simularSinRed, setSimularSinRed] = useState(false);
  useEffect(() => {
    const act = () => setNavegador(navigator.onLine);
    act();
    window.addEventListener('online', act);
    window.addEventListener('offline', act);
    return () => { window.removeEventListener('online', act); window.removeEventListener('offline', act); };
  }, []);
  return { enLinea: navegador && !simularSinRed, simularSinRed, setSimularSinRed };
}

export default function DemoCiudadano() {
  const [listo, setListo] = useState(false);
  const [ciudadano, setCiudadano] = useState<Ciudadano | null>(null);
  const [folio, setFolio] = useState<string | null>(null);
  const [cola, setCola] = useState<PendienteEnvio<DatosReporte>[]>([]);
  const { enLinea, simularSinRed, setSimularSinRed } = useConexion();

  useEffect(() => {
    setCiudadano(leerLocal<Ciudadano>(CLAVE_CIUDADANO));
    setFolio(leerLocal<string>(CLAVE_FOLIO));
    setCola(leerLocal<PendienteEnvio<DatosReporte>[]>(CLAVE_COLA) ?? []);
    setListo(true);
  }, []);

  const elegirFolio = useCallback((f: string | null) => { guardarLocal(CLAVE_FOLIO, f); setFolio(f); }, []);
  const fijarCola = useCallback((c: PendienteEnvio<DatosReporte>[]) => { guardarLocal(CLAVE_COLA, c.length ? c : null); setCola(c); }, []);

  // Al volver la conexión, la cola se envía sola.
  useEffect(() => {
    if (!enLinea || !cola.length) return;
    void vaciarCola(cola, async (p) => demo.crearReporte(p.datos)).then(({ enviados, restantes }) => {
      fijarCola(restantes);
      const ultimo = enviados.at(-1);
      if (ultimo) elegirFolio(ultimo.resultado.folio);
    });
  }, [enLinea, cola, fijarCola, elegirFolio]);

  function enviar(datos: DatosReporte) {
    if (!enLinea) {
      fijarCola(encolar(cola, `${Date.now()}`, datos));
      return null;
    }
    const r = demo.crearReporte(datos);
    elegirFolio(r.folio);
    return r.folio;
  }

  function borrar() {
    demo.borrarTodo();
    guardarLocal(CLAVE_CIUDADANO, null);
    fijarCola([]);
    elegirFolio(null);
    setCiudadano(null);
  }

  return (
    <main className="d-main">
      <p className="c-demo">{AVISO_DEMO}</p>
      <header className="d-cabecera">
        <h1>Pol-IAQ</h1>
        <div className="d-herramientas">
          <SelectorTema />
          <span className={`d-red ${enLinea ? 'ok' : 'sin'}`} role="status">{enLinea ? 'Con conexión' : 'Sin conexión'}</span>
        </div>
        <nav className="d-nav" aria-label="Demo">
          <Link href="/consola/" target="_blank">Consola del operador ↗</Link>
          <label className="c-check"><input type="checkbox" checked={simularSinRed} onChange={(e) => setSimularSinRed(e.target.checked)} /> Simular sin conexión</label>
          <VelocidadDemo />
          <button className="c-enlace" onClick={borrar}>Borrar datos de la demo</button>
        </nav>
      </header>
      {!listo ? null : cola.length > 0 ? (
        <EnCola cola={cola} enLinea={enLinea} alCancelar={() => fijarCola([])} />
      ) : !ciudadano ? (
        <Registro alRegistrar={(c) => { guardarLocal(CLAVE_CIUDADANO, c); setCiudadano(c); }} />
      ) : folio && demo.reporte(folio) ? (
        <Seguimiento folio={folio} alNuevo={() => elegirFolio(null)} />
      ) : (
        <NuevoReporte ciudadano={ciudadano} enviar={enviar} />
      )}
    </main>
  );
}

function VelocidadDemo() {
  const [v, setV] = useState(1);
  useEffect(() => { setV(demo.velocidad()); return demo.escuchar(() => setV(demo.velocidad())); }, []);
  return (
    <label className="c-check">Tiempo
      <select value={v} onChange={(e) => demo.fijarVelocidad(Number(e.target.value))} aria-label="Velocidad de la demo">
        <option value={1}>real</option>
        <option value={10}>acelerado ×10</option>
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Sin conexión: el reporte espera en el teléfono
// ---------------------------------------------------------------------------

function EnCola({ cola, enLinea, alCancelar }: { cola: PendienteEnvio<DatosReporte>[]; enLinea: boolean; alCancelar: () => void }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const urgente = debeOfrecer911(cola[0], ahora);
  const espera = Math.round((ahora - new Date(cola[0].creadoEn).getTime()) / 1000);
  return (
    <section className="c-tarjeta d-cola" aria-live="polite">
      <h2>{enLinea ? 'Enviando tu reporte…' : 'Sin conexión: tu reporte está guardado'}</h2>
      <p>Lo guardamos en este teléfono y <strong>se enviará solo</strong> en cuanto vuelva la señal. No cierres esta página.</p>
      <p className="suave d-nota">Esperando {duracionTexto(espera)} · {cola.length === 1 ? '1 reporte' : `${cola.length} reportes`} en espera</p>
      {urgente && (
        <p className="d-urgente" role="alert">No hemos podido enviarlo en {ESPERA_ANTES_DE_911_SEG} s. Si es una emergencia, <strong>llama al 911 ahora</strong>.</p>
      )}
      <a className={`d-boton-911 ${urgente ? 'urgente' : ''}`} href="tel:911">Llamar al 911</a>
      <button className="c-enlace" onClick={alCancelar}>Cancelar el envío</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

function Registro({ alRegistrar }: { alRegistrar: (c: Ciudadano) => void }) {
  const [nombre, setNombre] = useState('Ciudadano de prueba');
  const [telefono, setTelefono] = useState('4420000000');
  const [enviado, setEnviado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [acepto, setAcepto] = useState(false);
  const [error, setError] = useState('');

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^\d{10}$/.test(telefono)) return setError('Escribe un teléfono de 10 dígitos (puede ser inventado).');
    if (!enviado) return setEnviado(true);
    if (codigo !== CODIGO_SMS_DEMO) return setError(`Código incorrecto. En la demo el código es ${CODIGO_SMS_DEMO}.`);
    if (!acepto) return setError('Para continuar acepta el aviso de privacidad y los términos.');
    alRegistrar({ nombre: nombre.trim() || 'Ciudadano de prueba', telefono });
  }

  return (
    <form className="c-tarjeta c-form d-form" onSubmit={enviar}>
      <h2>Regístrate</h2>
      <p className="suave d-nota">Tu teléfono solo sirve para evitar reportes falsos. Al reportar podrás usar un seudónimo o ser anónimo.</p>
      <label>Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" /></label>
      <label>Teléfono (10 dígitos, de prueba)
        <input value={telefono} onChange={(e) => setTelefono(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="off" disabled={enviado} />
      </label>
      {enviado && (
        <>
          <label>Código SMS
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </label>
          <p className="suave d-nota">No se envía ningún SMS. En la demo el código es <code>{CODIGO_SMS_DEMO}</code>.</p>
          <label className="c-check">
            <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
            <span>Acepto el <Link href="/legal/aviso-simplificado/" target="_blank">aviso de privacidad</Link> y los <Link href="/legal/terminos/" target="_blank">términos</Link>.</span>
          </label>
        </>
      )}
      {error && <p className="c-error" role="alert">{error}</p>}
      <button className="c-boton d-enviar">{enviado ? 'Entrar' : 'Enviar código'}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Fotos: se reducen en el teléfono y se calcula su huella SHA-256
// ---------------------------------------------------------------------------

async function prepararFoto(archivo: File): Promise<Foto> {
  const bytes = await archivo.arrayBuffer();
  let sha256 = 'no-disponible';
  try {
    const h = await crypto.subtle.digest('SHA-256', bytes);
    sha256 = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { /* crypto.subtle requiere https */ }
  const url = await new Promise<string>((ok, mal) => {
    const img = new Image();
    const origen = URL.createObjectURL(archivo);
    img.onload = () => {
      const escala = Math.min(1, 800 / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(origen);
      ok(lienzo.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(origen); mal(new Error('imagen_invalida')); };
    img.src = origen;
  });
  return { tipo: 'foto', url, sha256, bytes: archivo.size, capturadoEn: new Date().toISOString() };
}

function BotonFoto({ fotos, alAgregar, disabled }: { fotos: number; alAgregar: (f: Foto) => void; disabled?: boolean }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  return (
    <div className="d-foto">
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        capture="environment"
        className="solo-lector"
        aria-label="Elegir foto"
        tabIndex={-1}
        onChange={async (e) => {
          const archivo = e.target.files?.[0];
          e.target.value = '';
          if (!archivo) return;
          setError('');
          setCargando(true);
          try { alAgregar(await prepararFoto(archivo)); } catch { setError('No se pudo leer la foto. Prueba con otra.'); }
          setCargando(false);
        }}
      />
      <button type="button" className="c-boton-sec d-boton-foto" disabled={disabled || cargando || fotos >= MAX_FOTOS} onClick={() => entrada.current?.click()}>
        <span aria-hidden="true">📷</span> {cargando ? 'Preparando foto…' : fotos >= MAX_FOTOS ? `Máximo ${MAX_FOTOS} fotos` : 'Agregar foto'}
      </button>
      {error && <p className="c-error" role="alert">{error}</p>}
    </div>
  );
}

function Miniaturas({ fotos, alQuitar }: { fotos: Foto[]; alQuitar?: (i: number) => void }) {
  if (!fotos.length) return null;
  return (
    <ul className="d-miniaturas">
      {fotos.map((f, i) => (
        <li key={i}>
          <img src={f.url} alt={`Foto ${i + 1}`} />
          {alQuitar && <button type="button" className="c-enlace" onClick={() => alQuitar(i)} aria-label={`Quitar foto ${i + 1}`}>Quitar</button>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Nuevo reporte: asistencia directa y formulario
// ---------------------------------------------------------------------------

const CATEGORIA: Record<string, string> = { seguridad: 'Seguridad', medico: 'Emergencia médica', proteccion_civil: 'Protección Civil', servicios_publicos: 'Servicios públicos' };
type Ubicacion = { lat: number; lng: number; precisionMetros?: number; referencia?: string };

function NuevoReporte({ ciudadano, enviar }: { ciudadano: Ciudadano; enviar: (d: DatosReporte) => string | null }) {
  const [incidenteId, setIncidenteId] = useState('robo-en-curso');
  const [lugarId, setLugarId] = useState(demo.LUGARES_DEMO[0].id);
  const [gps, setGps] = useState<Ubicacion | null>(null);
  const [gpsEstado, setGpsEstado] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [identidad, setIdentidad] = useState<Identidad>('completa');
  const [alias, setAlias] = useState('');
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [automatico, setAutomatico] = useState(true);
  const [panicoArmado, setPanicoArmado] = useState(false);
  const [error, setError] = useState('');

  const incidente = demo.CATALOGO.find((i) => i.id === incidenteId) ?? demo.CATALOGO[0];
  const preguntas = useMemo(() => demo.preguntasPara(incidente.id, respuestas), [incidente.id, respuestas]);
  const categorias = useMemo(() => [...new Set(demo.CATALOGO.map((i) => i.categoria))], []);
  const anonimoPermitido = demo.permiteAnonimo(incidente.id);

  useEffect(() => { if (!anonimoPermitido && identidad === 'anonimo') setIdentidad('seudonimo'); }, [anonimoPermitido, identidad]);
  useEffect(() => {
    if (!panicoArmado) return;
    const t = setTimeout(() => setPanicoArmado(false), 5000);
    return () => clearTimeout(t);
  }, [panicoArmado]);

  const responder = (id: string, v: Respuesta | undefined) => setRespuestas((r) => {
    const n = { ...r };
    if (v === undefined || v === '') delete n[id]; else n[id] = v;
    return n;
  });

  const ubicacion = (): Pick<DatosReporte, 'lugarId' | 'ubicacion'> => (lugarId === 'gps' && gps ? { ubicacion: gps } : { lugarId: lugarId === 'gps' ? demo.LUGARES_DEMO[0].id : lugarId });

  function usarGps() {
    setLugarId('gps');
    if (!('geolocation' in navigator)) return setGpsEstado('Este navegador no da la ubicación. Usa un lugar de prueba.');
    setGpsEstado('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude, precisionMetros: p.coords.accuracy, referencia: 'Ubicación del navegador' });
        setGpsEstado(`Listo (±${Math.round(p.coords.accuracy)} m). Fuera de los municipios piloto el reporte va al C5.`);
      },
      () => { setGpsEstado('No diste permiso o no hay señal. Se usará un lugar de prueba.'); setLugarId(demo.LUGARES_DEMO[0].id); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function panico() {
    if (!panicoArmado) return setPanicoArmado(true);
    setPanicoArmado(false);
    try {
      enviar({ incidenteId: 'otro', ...ubicacion(), respuestas: [], nombre: ciudadano.nombre, telefono: ciudadano.telefono, asistenciaDirecta: true, identidad: 'completa', cadSimulado: automatico });
    } catch (err) {
      setError(err instanceof demo.ErrorDemo ? `No se pudo enviar (${err.codigo}).` : 'No se pudo enviar.');
    }
  }

  function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (identidad === 'seudonimo' && alias.trim().length < 2) return setError('Escribe un seudónimo de al menos 2 letras.');
    try {
      const vigentes = new Set(preguntas.map((q) => q.id));
      enviar({
        incidenteId: incidente.id,
        ...ubicacion(),
        descripcion,
        respuestas: Object.entries(respuestas).filter(([k]) => vigentes.has(k)).map(([preguntaId, respuesta]) => ({ preguntaId, respuesta })),
        nombre: ciudadano.nombre,
        telefono: ciudadano.telefono,
        identidad,
        ...(identidad === 'seudonimo' && { alias: alias.trim() }),
        fotos,
        cadSimulado: automatico,
      });
    } catch (err) {
      setError(err instanceof demo.ErrorDemo ? `No se pudo crear el reporte (${err.codigo}).` : 'No se pudo crear el reporte.');
    }
  }

  return (
    <>
      <section className="d-panico-caja" aria-label="Botón de asistencia directa">
        <button type="button" className={`d-panico ${panicoArmado ? 'armado' : ''}`} onClick={panico} aria-describedby="panico-ayuda">
          <span className="d-panico-titulo">{panicoArmado ? 'Toca otra vez para enviar' : 'Pedir ayuda ya'}</span>
          <span className="d-panico-sub">Botón de asistencia directa</span>
        </button>
        <p id="panico-ayuda" className="suave d-nota">Envía tu ubicación con prioridad alta, sin escribir nada. Se pide un segundo toque para evitar envíos por accidente.</p>
      </section>

      <form className="c-tarjeta c-form d-form" onSubmit={crear}>
        <h2>O cuéntanos qué pasa</h2>
        <label>¿Qué está pasando?
          <select value={incidenteId} onChange={(e) => { setIncidenteId(e.target.value); setRespuestas({}); }}>
            {categorias.map((c) => (
              <optgroup key={c} label={CATEGORIA[c] ?? c}>
                {demo.CATALOGO.filter((i) => i.categoria === c).map((i) => <option key={i.id} value={i.id}>{i.nombreCiudadano}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>¿Dónde?
          <select value={lugarId} onChange={(e) => (e.target.value === 'gps' ? usarGps() : setLugarId(e.target.value))}>
            {demo.LUGARES_DEMO.map((l) => <option key={l.id} value={l.id}>{l.nombre} (prueba)</option>)}
            <option value="gps">Mi ubicación actual (GPS)</option>
          </select>
        </label>
        {lugarId === 'gps' && gpsEstado && <p className="suave d-nota" role="status">{gpsEstado}</p>}

        {preguntas.length > 0 && (
          <fieldset className="d-preguntas">
            <legend>Preguntas rápidas</legend>
            {preguntas.map((q) => (
              <div key={q.id} className="d-pregunta">
                <span id={`p-${q.id}`}>{q.texto}</span>
                {q.tipo === 'si_no' ? (
                  <div className="d-opciones" role="group" aria-labelledby={`p-${q.id}`}>
                    {([['Sí', true], ['No', false], ['No sé', 'no_sabe']] as const).map(([t, v]) => (
                      <button type="button" key={t} className={`d-opcion ${respuestas[q.id] === v ? 'sel' : ''}`} aria-pressed={respuestas[q.id] === v} onClick={() => responder(q.id, v)}>{t}</button>
                    ))}
                  </div>
                ) : q.tipo === 'opcion' ? (
                  <select value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value || undefined)} aria-labelledby={`p-${q.id}`}>
                    <option value="">Sin contestar</option>
                    {q.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                    <option value="no_sabe">No sé</option>
                  </select>
                ) : q.tipo === 'numero' ? (
                  <input type="number" min={0} inputMode="numeric" value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value === '' ? undefined : Number(e.target.value))} aria-labelledby={`p-${q.id}`} />
                ) : (
                  <input value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value)} aria-labelledby={`p-${q.id}`} maxLength={200} />
                )}
              </div>
            ))}
          </fieldset>
        )}

        <label>Detalles (opcional)<textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} maxLength={300} placeholder="Texto de prueba" /></label>

        <div className="d-grupo">
          <span className="d-etiqueta">Foto (opcional)</span>
          <Miniaturas fotos={fotos} alQuitar={(i) => setFotos((f) => f.filter((_, j) => j !== i))} />
          <BotonFoto fotos={fotos.length} alAgregar={(f) => setFotos((x) => [...x, f])} />
        </div>

        <fieldset className="d-modo">
          <legend>¿Cómo quieres reportar?</legend>
          <label className="d-radio">
            <input type="radio" name="identidad" checked={identidad === 'completa'} onChange={() => setIdentidad('completa')} />
            <span><strong>Con mi nombre</strong><small>El operador ve tu nombre y teléfono y puede llamarte.</small></span>
          </label>
          <label className="d-radio">
            <input type="radio" name="identidad" checked={identidad === 'seudonimo'} onChange={() => setIdentidad('seudonimo')} />
            <span><strong>Con un seudónimo</strong><small>Ve el seudónimo; tu teléfono queda oculto. Te escribe por el chat.</small></span>
          </label>
          {identidad === 'seudonimo' && (
            <label className="d-alias">Seudónimo<input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} placeholder="Por ejemplo: Vecina del 4" /></label>
          )}
          <label className={`d-radio ${anonimoPermitido ? '' : 'desactivado'}`}>
            <input type="radio" name="identidad" checked={identidad === 'anonimo'} disabled={!anonimoPermitido} onChange={() => setIdentidad('anonimo')} />
            <span><strong>Anónimo</strong><small>{anonimoPermitido ? 'No ve tu nombre ni tu teléfono.' : 'No disponible para robos, agresiones, disparos o violencia: el operador necesita poder contactarte. Usa un seudónimo.'}</small></span>
          </label>
        </fieldset>

        <fieldset className="d-modo">
          <legend>¿Quién despacha en esta demo?</legend>
          <label className="d-radio"><input type="radio" name="despacho" checked={automatico} onChange={() => setAutomatico(true)} /> <span><strong>El CAD simulado</strong><small>Recibe, asigna la unidad más cercana y la unidad llega por GPS.</small></span></label>
          <label className="d-radio"><input type="radio" name="despacho" checked={!automatico} onChange={() => setAutomatico(false)} /> <span><strong>Yo, desde la consola del operador</strong><small>Ábrela en otra pestaña con operador / operador.</small></span></label>
        </fieldset>
        {error && <p className="c-error" role="alert">{error}</p>}
        <button className="c-boton d-enviar">Enviar reporte</button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Seguimiento
// ---------------------------------------------------------------------------

function Seguimiento({ folio, alNuevo }: { folio: string; alNuevo: () => void }) {
  const [r, setR] = useState<ReporteDemo | undefined>(() => demo.reporte(folio));
  const [texto, setTexto] = useState('');
  const [, setPulso] = useState(0);

  useEffect(() => {
    setR(demo.reporte(folio));
    const quitar = demo.escuchar(() => setR(demo.reporte(folio)));
    const t = setInterval(() => setPulso((x) => x + 1), 1000);
    return () => { quitar(); clearInterval(t); };
  }, [folio]);

  if (!r) return <p>El reporte ya no existe. <button className="c-enlace" onClick={alNuevo}>Crear otro</button></p>;
  const final = FINALES.includes(r.estado);
  const incidente = demo.CATALOGO.find((i) => i.id === r.incidenteId);
  const recomendaciones = demo.recomendacionesPara(r.incidenteId);
  const t = demo.tiemposDe(r);
  const ahora = demo.ahora();
  const escalaEn = r.estado === 'recibido' && !r.folioCad && !r.cadSimulado && r.cadId !== 'c5-queretaro'
    ? Math.max(0, Math.ceil((new Date(r.creadoEn).getTime() + demo.ESPERA_ACUSE_SEG * 1000 - ahora) / 1000))
    : null;
  const u = r.unidad;
  const enSitio = r.estado === 'en_sitio' || r.estado === 'cerrado';

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    try { demo.mensajeCiudadano(folio, texto.trim()); setTexto(''); } catch { /* reporte finalizado */ }
  }

  return (
    <section className="d-seguimiento">
      <div className="c-tarjeta">
        <p className="suave d-nota">Tu folio</p>
        <p className="d-folio" data-testid="folio">{r.folio}</p>
        <p className="d-nota">{r.asistenciaDirecta ? 'Asistencia directa' : incidente?.nombreCiudadano} · {r.ubicacion.referencia}</p>
        <p className="d-nota">Atiende: <strong>{demo.nombreCad(r.cadId)}</strong> · {r.identidad === 'completa' ? 'con tu nombre' : r.identidad === 'seudonimo' ? `como “${r.alias}”` : 'anónimo'}</p>
        <p className={`d-estado d-${r.estado}`} data-testid="estado" role="status" aria-live="polite">{demo.etiquetaCiudadano(r.estado)}</p>

        {u && !final && (
          <div className="d-llegada" data-testid="llegada">
            {enSitio
              ? <><strong>{u.etiqueta}</strong> llegó al lugar</>
              : <><span className="d-eta">Llega en ~{u.etaMinutos ?? '?'} min</span><span>{u.etiqueta}{u.distanciaMetros ? ` · a ${u.distanciaMetros < 1000 ? `${Math.round(u.distanciaMetros / 10) * 10} m` : `${(u.distanciaMetros / 1000).toFixed(1)} km`}` : ''}</span></>}
          </div>
        )}
        {escalaEn !== null && (
          <p className="suave d-nota">Esperando que un operador lo reciba en la <Link href="/consola/" target="_blank">consola</Link>. Si nadie lo recibe en {escalaEn} s, pasa al C5 con el mismo folio.</p>
        )}

        <Mapa
          reporte={r.ubicacion}
          unidad={u?.lat != null && u.lng != null ? { id: u.unidadId, etiqueta: u.etiqueta, lat: u.lat, lng: u.lng, rumbo: u.rumbo } : null}
          etiquetaReporte="Tu reporte"
          alto={230}
          titulo={u ? `Mapa: ${u.etiqueta} rumbo a tu ubicación` : 'Mapa con la ubicación de tu reporte'}
        />

        {!final && (
          <div className="d-acciones">
            <a className="d-boton-911" href="tel:911">Llamar al 911</a>
            <button className="c-boton-sec d-cancelar" onClick={() => { try { demo.cancelar(folio); } catch { /* ya finalizado */ } }}>Cancelar reporte</button>
          </div>
        )}
      </div>

      <div className="c-tarjeta">
        <h3>¿Cuánto falta?</h3>
        <ol className="d-etapas" aria-label="Avance por etapas">
          {t.etapas.map((e) => (
            <li key={e.id} className={`d-etapa ${e.estado}`}>
              <span>{e.ciudadano}</span>
              <span className="suave">{e.segundos == null ? (e.estado === 'omitida' ? '—' : 'pendiente') : `${duracionTexto(e.segundos)}${e.estado === 'en_curso' || e.estado === 'en_riesgo' ? '…' : ''}`}</span>
            </li>
          ))}
        </ol>
        {t.llegada.segundos != null && (
          <p className="d-nota">
            {enSitio ? 'La unidad llegó en ' : 'Desde tu reporte: '}<strong>{duracionTexto(t.llegada.segundos)}</strong> · meta de llegada {Math.round(t.llegada.metaSegundos / 60)} min
            {t.llegada.estado === 'excedida' && <span className="c-chip c-chip-alerta">Fuera de meta</span>}
          </p>
        )}
      </div>

      {final && <Opinar r={r} />}
      {final && <button className="c-boton d-enviar" onClick={alNuevo}>Hacer otro reporte</button>}

      {recomendaciones.length > 0 && !final && (
        <div className="c-tarjeta">
          <h3>Mientras llega la unidad</h3>
          <ul>{recomendaciones.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      <div className="c-tarjeta">
        <h3>Fotos</h3>
        <Miniaturas fotos={r.evidencias} />
        {!r.evidencias.length && <p className="suave d-nota">Sin fotos.</p>}
        {!final && <BotonFoto fotos={r.evidencias.length} alAgregar={(f) => { try { demo.agregarFoto(folio, f); } catch { /* finalizado */ } }} />}
      </div>

      <div className="c-tarjeta">
        <h3>Mensajes</h3>
        {!r.mensajes.length && <p className="suave d-nota">Aún no hay mensajes.</p>}
        <ul className="d-mensajes">
          {r.mensajes.map((m) => (
            <li key={m.id} className={m.autor === 'ciudadano' ? 'yo' : ''}>
              <span className="suave">{m.autor === 'ciudadano' ? 'Tú' : m.nombreAutor ?? 'Operador'}</span>
              <p>{m.texto}</p>
            </li>
          ))}
        </ul>
        {!final && (
          <form className="d-chat" onSubmit={enviar}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe al operador" aria-label="Mensaje al operador" maxLength={300} />
            <button className="c-boton">Enviar</button>
          </form>
        )}
      </div>

      <details className="c-tarjeta">
        <summary><h3 className="d-inline">Historial</h3></summary>
        <ul className="d-historial">
          {[...r.historial].reverse().map((h, i) => (
            <li key={i}><span className="suave">{new Date(h.en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {demo.etiquetaCiudadano(h.estado)}{h.nota ? ` · ${h.nota}` : ''}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calificación y queja después del cierre
// ---------------------------------------------------------------------------

function Opinar({ r }: { r: ReporteDemo }) {
  const [llego, setLlego] = useState<Opinion['llegoUnidad'] | null>(null);
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState('');

  if (r.opinion) {
    return (
      <div className={`c-tarjeta d-gracias ${r.opinion.queja ? 'queja' : ''}`} role="status">
        <h3>{r.opinion.queja ? 'Registramos tu queja' : '¡Gracias por calificar!'}</h3>
        <p className="d-nota">{r.opinion.queja ? `Supervisión revisará el folio ${r.folio}. Tu queja queda registrada con fecha y hora.` : 'Tu opinión ayuda a mejorar la atención.'}</p>
      </div>
    );
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!llego) return setError('Dinos si llegó la unidad.');
    if (!estrellas) return setError('Elige de 1 a 5 estrellas.');
    try { demo.opinar(r.folio, { llegoUnidad: llego, calificacion: estrellas, ...(comentario.trim() && { comentario: comentario.trim() }) }); } catch (err) {
      setError(err instanceof demo.ErrorDemo ? `No se pudo enviar (${err.codigo}).` : 'No se pudo enviar.');
    }
  }

  return (
    <form className="c-tarjeta d-form d-opinar" onSubmit={enviar}>
      <h3>¿Cómo te atendimos?</h3>
      <fieldset className="d-sin-borde">
        <legend>¿Llegó la unidad?</legend>
        <div className="d-opciones grandes">
          {([['si', 'Sí llegó'], ['tarde', 'Llegó tarde'], ['no', 'No llegó nadie']] as const).map(([v, t]) => (
            <button type="button" key={v} className={`d-opcion ${llego === v ? 'sel' : ''}`} aria-pressed={llego === v} onClick={() => setLlego(v)}>{t}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="d-sin-borde">
        <legend>Califica la atención</legend>
        <div className="d-estrellas">
          {[1, 2, 3, 4, 5].map((n) => (
            <button type="button" key={n} className={n <= estrellas ? 'sel' : ''} aria-pressed={n === estrellas} aria-label={`${n} de 5 estrellas`} onClick={() => setEstrellas(n)}>★</button>
          ))}
        </div>
      </fieldset>
      <label>Comentario o queja (opcional)<textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={500} /></label>
      {error && <p className="c-error" role="alert">{error}</p>}
      <button className="c-boton d-enviar">Enviar</button>
      <p className="suave d-nota">Si no llegó nadie o calificas con 1 o 2 estrellas, se registra como queja para supervisión.</p>
    </form>
  );
}
