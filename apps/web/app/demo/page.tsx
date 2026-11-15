'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './demo.css';
import {
  ESPERA_ANTES_DE_911_SEG, TIPOS_CNIE, buscarCnie, debeOfrecer911, duracionTexto, encolar, enmascararTelefono, incidenteCnie, incidentesDeSubtipo, nombreLegible,
  subtiposDeTipo, vaciarCola, type IncidenteCnie, type Identidad, type Opinion, type PendienteEnvio,
} from '@pol-iaq/shared/movil';
import { CODIGO_SMS_DEMO } from '../../lib/demo/textos';
import { horaLocal } from '../../lib/hora';
import * as demo from '../../lib/demo/motor';
import type { EvidenciaDemo, NuevoReporte as DatosReporte, ReporteDemo } from '../../lib/demo/motor';
import { Mapa } from '../../lib/mapa/Mapa';
import { SelectorTema } from '../../lib/tema';
import { Logo, Marca } from '../../lib/marca';

type Respuesta = string | number | boolean;
type Foto = Omit<EvidenciaDemo, 'id'>;
type Pestana = 'reportar' | 'mireporte' | 'perfil';
interface Ciudadano { nombre: string; telefono: string }
interface Ajustes { automatico: boolean }

const CLAVE_CIUDADANO = 'poliaq.demo.ciudadano';
const CLAVE_FOLIO = 'poliaq.demo.folio';
const CLAVE_FOLIOS = 'poliaq.demo.folios';
const CLAVE_COLA = 'poliaq.demo.cola';
const CLAVE_AJUSTES = 'poliaq.demo.ajustes';
const FINALES = ['cerrado', 'improcedente', 'cancelado'];
const MAX_FOTOS = 3;
/** Ventana para confirmar el botón de asistencia directa con el segundo toque. */
const VENTANA_ASISTENCIA_SEG = 12;

function leerLocal<T>(clave: string): T | null {
  try { const t = localStorage.getItem(clave); return t ? (JSON.parse(t) as T) : null; } catch { return null; }
}
function guardarLocal(clave: string, v: unknown) {
  try { if (v === null) localStorage.removeItem(clave); else localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}
const telefonoLegible = (t: string) => (t.length === 10 ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}` : t);

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

// ---------------------------------------------------------------------------
// Íconos (SVG en línea: nítidos a cualquier tamaño y sin descargas)
// ---------------------------------------------------------------------------

function Icono({ d, tam = 24 }: { d: string; tam?: number }) {
  return <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const ICONO = {
  reportar: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4zM12 8v5M12 16h.01',
  mireporte: 'M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21zM12 7v3l2 1.5',
  perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  atras: 'M15 18l-6-6 6-6',
  foto: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  telefono: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  ubicacion: 'M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
};

/** Nombre corto y emoji de cada incidente del catálogo para la cuadrícula de inicio. */
/** Icono de cada botón. El nombre viene del catálogo compartido (`nombreCorto`), el mismo que ve la consola. */
const ICONO_INCIDENTE: Record<string, string> = {
  'robo-en-curso': '🚨', agresion: '👊', 'intrusion-domicilio': '🚪', 'violencia-familiar': '🏠', disparos: '💥', 'persona-sospechosa': '👀',
  'accidente-vial': '🚗', 'emergencia-medica': '❤️', 'persona-lesionada': '🩹', incendio: '🔥', 'fuga-gas': '⚠️', inundacion: '🌊', 'ruido-rina': '🔊', otro: '➕',
};
const MOSAICO: Record<string, [string, string]> = Object.fromEntries(demo.CATALOGO.map((i) => [i.id, [ICONO_INCIDENTE[i.id] ?? '❗', i.nombreCorto]]));
/** Nombre corto en el seguimiento, junto al subtipo CNIE: "Robo (CNIE 304)". */
const SEGUIMIENTO: Record<string, string> = { 'robo-en-curso': 'Robo' };

/** Código CNIE completo del reporte (5 dígitos; el subtipo solo si aún falta el incidente). */
const codigoCnieDe = (r: Pick<ReporteDemo, 'cnie'>) => r.cnie?.incidente?.codigo ?? r.cnie?.subtipo.codigo ?? null;
/** "Disparos (CNIE 30202)": así dos incidentes del mismo subtipo no se ven iguales. */
const tituloConCodigo = (r: Pick<ReporteDemo, 'incidenteId' | 'asistenciaDirecta' | 'cnie'>) => `${tituloReporte(r)}${codigoCnieDe(r) ? ` (CNIE ${codigoCnieDe(r)})` : ''}`;

/** Título del reporte para el ciudadano. En "Otra emergencia" con incidente elegido, su nombre. */
function tituloReporte(r: Pick<ReporteDemo, 'incidenteId' | 'asistenciaDirecta' | 'cnie'>) {
  if (r.asistenciaDirecta) return 'Asistencia directa';
  if (r.incidenteId === 'otro' && r.cnie?.incidente) return nombreLegible(r.cnie.incidente.nombre);
  return SEGUIMIENTO[r.incidenteId] ?? MOSAICO[r.incidenteId]?.[1] ?? r.incidenteId;
}

// ---------------------------------------------------------------------------
// App: barra superior, contenido por pestaña y barra de pestañas inferior
// ---------------------------------------------------------------------------

export default function DemoCiudadano() {
  const [listo, setListo] = useState(false);
  const [ciudadano, setCiudadano] = useState<Ciudadano | null>(null);
  const [folio, setFolio] = useState<string | null>(null);
  const [folios, setFolios] = useState<string[]>([]);
  const [cola, setCola] = useState<PendienteEnvio<DatosReporte>[]>([]);
  const [ajustes, setAjustes] = useState<Ajustes>({ automatico: true });
  const [pestana, setPestana] = useState<Pestana>('reportar');
  const [recienEnviado, setRecienEnviado] = useState<string | null>(null);
  const { enLinea, simularSinRed, setSimularSinRed } = useConexion();
  const principal = useRef<HTMLElement>(null);

  useEffect(() => {
    setCiudadano(leerLocal<Ciudadano>(CLAVE_CIUDADANO));
    const f = leerLocal<string>(CLAVE_FOLIO);
    setFolio(f);
    setFolios(leerLocal<string[]>(CLAVE_FOLIOS) ?? (f ? [f] : []));
    setCola(leerLocal<PendienteEnvio<DatosReporte>[]>(CLAVE_COLA) ?? []);
    setAjustes(leerLocal<Ajustes>(CLAVE_AJUSTES) ?? { automatico: true });
    if (f && demo.reporte(f) && !FINALES.includes(demo.reporte(f)!.estado)) setPestana('mireporte');
    setListo(true);
  }, []);

  const irA = useCallback((p: Pestana) => {
    setPestana(p);
    window.scrollTo({ top: 0 });
    principal.current?.focus({ preventScroll: true });
  }, []);

  const abrirFolio = useCallback((f: string | null) => {
    guardarLocal(CLAVE_FOLIO, f);
    setFolio(f);
    if (f) setFolios((l) => { const n = [f, ...l.filter((x) => x !== f)].slice(0, 20); guardarLocal(CLAVE_FOLIOS, n); return n; });
  }, []);
  const fijarCola = useCallback((c: PendienteEnvio<DatosReporte>[]) => { guardarLocal(CLAVE_COLA, c.length ? c : null); setCola(c); }, []);
  const fijarAjustes = (a: Ajustes) => { guardarLocal(CLAVE_AJUSTES, a); setAjustes(a); };

  // Al volver la conexión, la cola se envía sola.
  useEffect(() => {
    if (!enLinea || !cola.length) return;
    void vaciarCola(cola, async (p) => demo.crearReporte(p.datos)).then(({ enviados, restantes }) => {
      fijarCola(restantes);
      const ultimo = enviados.at(-1);
      if (ultimo) { abrirFolio(ultimo.resultado.folio); setRecienEnviado(ultimo.resultado.folio); }
    });
  }, [enLinea, cola, fijarCola, abrirFolio]);

  /** Devuelve el folio, o null si se guardó en la cola por falta de conexión. */
  function enviar(datos: Omit<DatosReporte, 'cadSimulado' | 'nombre' | 'telefono'>) {
    const completo: DatosReporte = { ...datos, nombre: ciudadano!.nombre, telefono: ciudadano!.telefono, cadSimulado: ajustes.automatico };
    if (!enLinea) {
      fijarCola(encolar(cola, `${Date.now()}`, completo));
      irA('mireporte');
      return null;
    }
    const r = demo.crearReporte(completo);
    abrirFolio(r.folio);
    setRecienEnviado(r.folio);
    irA('mireporte');
    return r.folio;
  }

  function borrar() {
    demo.borrarTodo();
    for (const c of [CLAVE_CIUDADANO, CLAVE_FOLIOS, CLAVE_AJUSTES]) guardarLocal(c, null);
    fijarCola([]);
    abrirFolio(null);
    setFolios([]);
    setCiudadano(null);
    setPestana('reportar');
  }

  const activo = folio ? demo.reporte(folio) : undefined;
  const hayActivo = !!activo && !FINALES.includes(activo.estado);

  if (!listo) {
    return (
      <div className="app" aria-busy="true">
        <div className="barra-app"><span className="esqueleto d-esq-marca" /></div>
        <main className="app-contenido"><div className="esqueleto d-esq-boton" /><div className="d-mosaicos">{Array.from({ length: 6 }, (_, i) => <div key={i} className="esqueleto d-esq-mosaico" />)}</div></main>
        <span className="solo-lector">Cargando…</span>
      </div>
    );
  }

  if (!ciudadano) {
    return (
      <div className="app sin-pestanas">
        <main className="app-contenido" id="contenido">
          <Registro alRegistrar={(c) => { guardarLocal(CLAVE_CIUDADANO, c); setCiudadano(c); }} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      <header className="barra-app">
        <Marca tam={32} />
        <span className={`d-red ${enLinea ? 'ok' : 'sin'}`} role="status">{enLinea ? 'En línea' : 'Sin conexión'}</span>
      </header>
      <p className="d-aviso-demo">Demo con datos de prueba · nada llega a la policía</p>

      <main className="app-contenido" id="contenido" ref={principal} tabIndex={-1}>
        {pestana === 'reportar' && (
          <PantallaReportar enviar={enviar} hayActivo={hayActivo} alVerActivo={() => irA('mireporte')} enLinea={enLinea} />
        )}
        {pestana === 'mireporte' && (
          <PantallaMiReporte
            folio={folio}
            folios={folios}
            cola={cola}
            enLinea={enLinea}
            recienEnviado={recienEnviado}
            alAbrir={(f) => { abrirFolio(f); setRecienEnviado(null); window.scrollTo({ top: 0 }); }}
            alNuevo={() => { abrirFolio(null); setRecienEnviado(null); irA('reportar'); }}
            alCancelarCola={() => fijarCola([])}
          />
        )}
        {pestana === 'perfil' && (
          <PantallaPerfil
            ciudadano={ciudadano}
            ajustes={ajustes}
            alAjustes={fijarAjustes}
            simularSinRed={simularSinRed}
            alSimularSinRed={setSimularSinRed}
            alBorrar={borrar}
          />
        )}
      </main>

      <nav className="pestanas" aria-label="Secciones">
        {([['reportar', 'Reportar'], ['mireporte', 'Mi reporte'], ['perfil', 'Perfil']] as const).map(([p, t]) => (
          <button key={p} type="button" className={pestana === p ? 'activa' : ''} aria-current={pestana === p ? 'page' : undefined} onClick={() => irA(p)}>
            <span className="pestana-icono">
              <Icono d={ICONO[p]} />
              {p === 'mireporte' && (hayActivo || cola.length > 0) && <span className="pestana-punto" aria-hidden="true" />}
            </span>
            <span>{t}</span>
            {p === 'mireporte' && (hayActivo || cola.length > 0) && <span className="solo-lector"> (en curso)</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

function Registro({ alRegistrar }: { alRegistrar: (c: Ciudadano) => void }) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [acepto, setAcepto] = useState(false);
  const [error, setError] = useState('');

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^\d{10}$/.test(telefono)) return setError('Escribe tu teléfono de 10 dígitos. En la demo puede ser inventado.');
    if (!enviado) return setEnviado(true);
    if (codigo !== CODIGO_SMS_DEMO) return setError(`Ese código no es correcto. En la demo es ${CODIGO_SMS_DEMO}.`);
    if (!acepto) return setError('Para continuar, acepta el aviso de privacidad y los términos.');
    alRegistrar({ nombre: nombre.trim() || 'Ciudadano de prueba', telefono });
  }

  return (
    <div className="d-registro">
      <div className="d-bienvenida">
        <Logo tam={168} />
        <h1>Pide ayuda en segundos</h1>
        <p>Reporta una emergencia a la policía de tu municipio y mira cuándo llega la unidad.</p>
      </div>
      <form className="c-tarjeta d-form" onSubmit={enviar} noValidate>
        {!enviado ? (
          <>
            <label><span>{'Tu nombre (opcional)'}</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" placeholder="Como quieras que te llamen" />
            </label>
            <label>Tu teléfono
              <input value={telefono} onChange={(e) => setTelefono(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="tel-national" placeholder="10 dígitos" aria-describedby="tel-ayuda" />
            </label>
            <p id="tel-ayuda" className="suave d-nota">Te mandamos un código para evitar reportes falsos. Podrás reportar con seudónimo o de forma anónima.</p>
          </>
        ) : (
          <>
            <p className="d-nota d-linea"><span>Enviamos un código al <strong>{telefonoLegible(telefono)}</strong>.</span><button type="button" className="c-enlace" onClick={() => { setEnviado(false); setCodigo(''); }}>Cambiar</button></p>
            <label>Código de 6 dígitos
              <input className="d-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-describedby="codigo-ayuda" />
            </label>
            <p id="codigo-ayuda" className="suave d-nota">En la demo no se envía ningún SMS: el código es <code>{CODIGO_SMS_DEMO}</code>.</p>
            <label className="d-check">
              <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
              <span>Acepto el <Link href="/legal/aviso-simplificado/" target="_blank">aviso de privacidad</Link> y los <Link href="/legal/terminos/" target="_blank">términos</Link>.</span>
            </label>
          </>
        )}
        {error && <p className="c-error" role="alert">{error}</p>}
        <button className="c-boton c-grande c-ancho">{enviado ? 'Entrar' : 'Enviarme el código'}</button>
      </form>
      <p className="suave d-nota d-centro">Si no puedes usar la app, llama al <a href="tel:911">911</a>.</p>
    </div>
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
  const [ultimo, setUltimo] = useState('');
  return (
    <div className="d-foto">
      {/* El selector nativo queda oculto (y fuera del lector de pantalla): su "Ningún archivo seleccionado" no se actualiza. El estado lo dice el texto de abajo. */}
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        capture="environment"
        className="solo-lector"
        aria-hidden="true"
        data-testid="elegir-foto"
        tabIndex={-1}
        onChange={async (e) => {
          const archivo = e.target.files?.[0];
          e.target.value = '';
          if (!archivo) return;
          setError('');
          setCargando(true);
          try { alAgregar(await prepararFoto(archivo)); setUltimo(archivo.name); } catch { setError('No se pudo leer la foto. Prueba con otra.'); }
          setCargando(false);
        }}
      />
      <button type="button" className="c-boton-sec c-ancho" disabled={disabled || cargando || fotos >= MAX_FOTOS} onClick={() => entrada.current?.click()}>
        <Icono d={ICONO.foto} tam={20} />{cargando ? 'Preparando foto…' : fotos >= MAX_FOTOS ? `Máximo ${MAX_FOTOS} fotos` : fotos ? 'Agregar otra foto' : 'Agregar foto'}
      </button>
      <p className="suave c-pequeno d-foto-estado" role="status" data-testid="foto-estado">
        {fotos ? `${fotos === 1 ? '1 foto adjunta' : `${fotos} fotos adjuntas`}${ultimo ? `. Última: ${ultimo}` : ''}` : 'Sin fotos adjuntas'}
      </p>
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
          <div className="d-mini-info">
            <span className="suave">Huella digital SHA-256</span>
            <code className="d-hash" data-testid="hash-ciudadano" title={f.sha256}>{f.sha256}</code>
            {alQuitar && <button type="button" className="c-enlace" onClick={() => alQuitar(i)} aria-label={`Quitar foto ${i + 1}`}>Quitar</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Reportar: botón de asistencia directa + cuadrícula de incidentes + confirmar
// ---------------------------------------------------------------------------

type Ubicacion = { lat: number; lng: number; precisionMetros?: number; referencia?: string };
type Envio = Omit<DatosReporte, 'cadSimulado' | 'nombre' | 'telefono'>;

function PantallaReportar({ enviar, hayActivo, alVerActivo, enLinea }: { enviar: (d: Envio) => string | null; hayActivo: boolean; alVerActivo: () => void; enLinea: boolean }) {
  const [incidenteId, setIncidenteId] = useState<string | null>(null);
  const [explorar, setExplorar] = useState(false);
  const [codigoCnie, setCodigoCnie] = useState<string | null>(null);
  const [lugarId, setLugarId] = useState(demo.LUGARES_DEMO[0].id);
  const [gps, setGps] = useState<Ubicacion | null>(null);
  const [error, setError] = useState('');

  const ubicacion = (): Pick<DatosReporte, 'lugarId' | 'ubicacion'> => (lugarId === 'gps' && gps ? { ubicacion: gps } : { lugarId: lugarId === 'gps' ? demo.LUGARES_DEMO[0].id : lugarId });

  function asistencia() {
    setError('');
    try { enviar({ incidenteId: 'otro', ...ubicacion(), respuestas: [], asistenciaDirecta: true, identidad: 'completa' }); } catch (err) {
      setError(err instanceof demo.ErrorDemo ? `No se pudo enviar (${err.codigo}).` : 'No se pudo enviar.');
    }
  }

  if (explorar && !incidenteId) {
    return (
      <ExplorarCatalogo
        alElegir={(codigo) => { setCodigoCnie(codigo); setIncidenteId('otro'); window.scrollTo({ top: 0 }); }}
        alVolver={() => setExplorar(false)}
      />
    );
  }

  if (incidenteId) {
    return (
      <Confirmar
        incidenteId={incidenteId}
        codigoCnie={incidenteId === 'otro' ? codigoCnie : null}
        lugarId={lugarId}
        alLugar={setLugarId}
        gps={gps}
        alGps={setGps}
        ubicacion={ubicacion}
        enviar={enviar}
        enLinea={enLinea}
        alVolver={() => { setIncidenteId(null); setCodigoCnie(null); }}
      />
    );
  }

  return (
    <div className="d-pantalla">
      {hayActivo && (
        <button type="button" className="d-en-curso" onClick={alVerActivo}>
          <span className="d-en-curso-punto" aria-hidden="true" /> Tienes un reporte en curso <span aria-hidden="true">›</span>
        </button>
      )}
      <BotonAsistencia alEnviar={asistencia} />
      {error && <ErrorEnvio mensaje={error} alReintentar={asistencia} />}

      <section aria-labelledby="que-pasa">
        <h2 id="que-pasa" className="d-titulo-seccion">¿Qué está pasando?</h2>
        <div className="d-mosaicos">
          {demo.CATALOGO.map((i) => {
            const [emoji, corto] = MOSAICO[i.id] ?? ['❗', i.nombreCiudadano];
            return (
              <button key={i.id} type="button" className={`d-mosaico p-${i.prioridad}`} onClick={() => { if (i.id === 'otro') setExplorar(true); else setIncidenteId(i.id); window.scrollTo({ top: 0 }); }}>
                <span className="d-mosaico-emoji" aria-hidden="true">{emoji}</span>
                <span>{corto}</span>
              </button>
            );
          })}
        </div>
      </section>
      <a className="d-llamar" href="tel:911"><Icono d={ICONO.telefono} tam={20} /> Prefiero llamar al 911</a>
    </div>
  );
}

/** Dos toques: el primero arma el botón y empieza una cuenta atrás visible; el segundo envía. */
function BotonAsistencia({ alEnviar }: { alEnviar: () => void }) {
  const [armadoHasta, setArmadoHasta] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!armadoHasta) return;
    const t = setInterval(() => {
      const n = Date.now();
      setAhora(n);
      if (n >= armadoHasta) setArmadoHasta(null);
    }, 200);
    return () => clearInterval(t);
  }, [armadoHasta]);

  const restante = armadoHasta ? Math.max(0, Math.ceil((armadoHasta - ahora) / 1000)) : 0;
  const armado = armadoHasta != null && restante > 0;

  function tocar() {
    if (!armado) { const n = Date.now(); setAhora(n); setArmadoHasta(n + VENTANA_ASISTENCIA_SEG * 1000); return; }
    setArmadoHasta(null);
    alEnviar();
  }

  return (
    <section className="d-panico-caja" aria-label="Botón de asistencia directa">
      <button type="button" className={`d-panico ${armado ? 'armado' : ''}`} onClick={tocar} aria-describedby="panico-ayuda">
        <span className="d-panico-titulo">{armado ? 'Toca otra vez para enviar' : 'Pedir ayuda ya'}</span>
        <span className="d-panico-sub">{armado ? `Se cancela en ${restante} s` : 'Botón de asistencia directa'}</span>
        {armado && <span className="d-panico-barra" style={{ transform: `scaleX(${Math.max(0, (armadoHasta! - ahora) / (VENTANA_ASISTENCIA_SEG * 1000))})` }} aria-hidden="true" />}
      </button>
      <p id="panico-ayuda" className="suave d-nota" aria-live="polite">
        {armado
          ? <span className="d-linea"><span>{`Tienes ${VENTANA_ASISTENCIA_SEG} segundos para confirmar.`}</span><button type="button" className="c-enlace" onClick={() => setArmadoHasta(null)}>No enviar</button></span>
          : 'Envía tu ubicación con prioridad alta sin escribir nada. Pide un segundo toque para evitar envíos por accidente.'}
      </p>
    </section>
  );
}

function ErrorEnvio({ mensaje, alReintentar }: { mensaje: string; alReintentar: () => void }) {
  return (
    <div className="estado estado-error" role="alert">
      <h3>No se pudo enviar tu reporte</h3>
      <p>{mensaje}</p>
      <div className="d-fila-botones">
        <button type="button" className="c-boton" onClick={alReintentar}>Reintentar</button>
        <a className="c-boton-sec" href="tel:911">Llamar al 911</a>
      </div>
    </div>
  );
}

/**
 * "Otra emergencia": todo el catálogo nacional en lenguaje simple (tipo, luego
 * subtipo, luego el caso) o buscando con palabras. No muestra códigos.
 */
function ExplorarCatalogo({ alElegir, alVolver }: { alElegir: (codigo: string | null) => void; alVolver: () => void }) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<string | null>(null);
  const [subtipo, setSubtipo] = useState<string | null>(null);
  const resultados = useMemo(() => (texto.trim().length >= 2 ? buscarCnie(texto, 25) : []), [texto]);
  const atras = () => (subtipo ? setSubtipo(null) : tipo ? setTipo(null) : alVolver());
  const nombreTipo = TIPOS_CNIE.find((t) => t.codigo === tipo)?.nombre;
  const nombreSubtipo = subtipo ? subtiposDeTipo(tipo!).find((x) => x.codigo === subtipo)?.nombreCorto : null;

  const Caso = ({ i, contexto }: { i: IncidenteCnie; contexto?: boolean }) => (
    <li>
      <button type="button" onClick={() => alElegir(i.codigo)}>
        <span>{nombreLegible(i.nombre)}<span className="suave c-pequeno" data-testid="codigo-caso">{contexto ? `${i.codigo} · ${i.tipo.nombre} · ${i.subtipo.nombreCorto}` : i.codigo}</span></span>
        <span aria-hidden="true">›</span>
      </button>
    </li>
  );

  return (
    <div className="d-pantalla d-catalogo">
      <div className="d-encabezado">
        <button type="button" className="d-atras" onClick={atras} aria-label="Volver"><Icono d={ICONO.atras} /></button>
        <h2>{nombreSubtipo ?? nombreTipo ?? 'Otra emergencia'}</h2>
      </div>
      <label className="d-campo">Busca con tus palabras
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Por ejemplo: árbol caído, persona perdida" data-testid="catalogo-buscar" autoComplete="off" />
      </label>
      {texto.trim().length >= 2 ? (
        resultados.length ? (
          <ul className="d-lista-catalogo" aria-label="Resultados">{resultados.map((i) => <Caso key={i.codigo} i={i} contexto />)}</ul>
        ) : <p className="suave d-nota">No encontramos eso. Prueba con otra palabra o descríbelo con tus palabras.</p>
      ) : !tipo ? (
        <ul className="d-lista-catalogo" aria-label="Tipos de emergencia">
          {TIPOS_CNIE.map((t) => (
            <li key={t.codigo}><button type="button" onClick={() => setTipo(t.codigo)}><span>{t.nombre}</span><span aria-hidden="true">›</span></button></li>
          ))}
        </ul>
      ) : !subtipo ? (
        <ul className="d-lista-catalogo" aria-label={`Opciones de ${nombreTipo}`}>
          {subtiposDeTipo(tipo).map((x) => (
            <li key={x.codigo}><button type="button" onClick={() => setSubtipo(x.codigo)}><span>{x.nombreCorto}</span><span aria-hidden="true">›</span></button></li>
          ))}
        </ul>
      ) : (
        <ul className="d-lista-catalogo" aria-label={`Casos de ${nombreSubtipo}`}>{incidentesDeSubtipo(subtipo).map((i) => <Caso key={i.codigo} i={i} />)}</ul>
      )}
      <button type="button" className="c-boton-sec c-ancho" onClick={() => alElegir(null)}>No lo encuentro: lo cuento con mis palabras</button>
    </div>
  );
}

/** Seudónimo que se propone si la persona no escribe uno: "Vecino 482". */
const seudonimoSugerido = () => `Vecino ${100 + Math.floor(Math.random() * 900)}`;

const IDENTIDADES: [Identidad, string][] = [['completa', 'Con mi nombre'], ['seudonimo', 'Seudónimo'], ['anonimo', 'Anónimo']];

function Confirmar({
  incidenteId, codigoCnie, lugarId, alLugar, gps, alGps, ubicacion, enviar, enLinea, alVolver,
}: {
  incidenteId: string; codigoCnie: string | null; lugarId: string; alLugar: (l: string) => void; gps: Ubicacion | null; alGps: (u: Ubicacion | null) => void;
  ubicacion: () => Pick<DatosReporte, 'lugarId' | 'ubicacion'>; enviar: (d: Envio) => string | null; enLinea: boolean; alVolver: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [identidad, setIdentidad] = useState<Identidad>('completa');
  const [alias, setAlias] = useState('');
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [gpsEstado, setGpsEstado] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [error, setError] = useState('');
  const [ciudadanoTel, setCiudadanoTel] = useState('');

  const incidente = demo.CATALOGO.find((i) => i.id === incidenteId) ?? demo.CATALOGO[0];
  const elegido = codigoCnie ? incidenteCnie(codigoCnie) : undefined;
  const [emoji, corto] = elegido ? ['📋', nombreLegible(elegido.nombre)] : MOSAICO[incidente.id] ?? ['❗', incidente.nombreCiudadano];
  const preguntas = useMemo(() => demo.preguntasPara(incidente.id, respuestas), [incidente.id, respuestas]);
  // El anónimo depende del tipo de emergencia y, a veces, de lo que se contesta (por ejemplo, si hay heridos).
  const anonimoPermitido = demo.permiteAnonimo(incidente.id, respuestas, codigoCnie);
  const aliasRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCiudadanoTel(leerLocal<Ciudadano>(CLAVE_CIUDADANO)?.telefono ?? ''); }, []);
  useEffect(() => { if (!anonimoPermitido && identidad === 'anonimo') setIdentidad('seudonimo'); }, [anonimoPermitido, identidad]);
  // Con seudónimo nunca queda vacío: si no lo escribe, se le propone uno que puede cambiar.
  useEffect(() => { if (identidad === 'seudonimo') setAlias((a) => a || seudonimoSugerido()); }, [identidad]);

  const responder = (id: string, v: Respuesta | undefined) => setRespuestas((r) => {
    const n = { ...r };
    if (v === undefined || v === '' || n[id] === v) delete n[id]; else n[id] = v;
    return n;
  });

  function usarGps() {
    alLugar('gps');
    setGpsError('');
    const sinGps = (motivo: string) => {
      // Sin ubicación no se bloquea el reporte: se usa un lugar de prueba y se ofrece reintentar.
      setGpsEstado('');
      setGpsError(`${motivo} Mientras tanto usamos «${demo.LUGARES_DEMO[0].nombre}». Puedes reintentar o elegir otro lugar.`);
      alLugar(demo.LUGARES_DEMO[0].id);
    };
    if (!('geolocation' in navigator)) { sinGps('Este navegador no da la ubicación.'); return; }
    setGpsEstado('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        alGps({ lat: p.coords.latitude, lng: p.coords.longitude, precisionMetros: p.coords.accuracy, referencia: 'Ubicación del navegador' });
        setGpsEstado(`Listo (±${Math.round(p.coords.accuracy)} m). Fuera de los municipios piloto el reporte va al C5.`);
      },
      () => sinGps('No pudimos obtener tu ubicación: no diste permiso o no hay señal de GPS.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function crear(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    if (identidad === 'seudonimo' && alias.trim().length < 2) {
      setError('Escribe un seudónimo de al menos 2 letras.');
      aliasRef.current?.focus();
      return;
    }
    try {
      const vigentes = new Set(preguntas.map((q) => q.id));
      enviar({
        incidenteId: incidente.id,
        ...ubicacion(),
        descripcion,
        respuestas: Object.entries(respuestas).filter(([k]) => vigentes.has(k)).map(([preguntaId, respuesta]) => ({ preguntaId, respuesta })),
        identidad,
        ...(identidad === 'seudonimo' && { alias: alias.trim() }),
        ...(codigoCnie && { codigoCnie }),
        fotos,
      });
    } catch (err) {
      setError(err instanceof demo.ErrorDemo ? `El sistema respondió: ${err.codigo}.` : 'Algo falló al crear el reporte.');
    }
  }

  const veraLaPolicia = identidad === 'completa'
    ? `Tu nombre y tu teléfono ${telefonoLegible(ciudadanoTel)}. Te pueden llamar.`
    : identidad === 'seudonimo'
      ? (alias.trim() ? `“${alias.trim()}” y que tu teléfono termina en ${ciudadanoTel.slice(-4)}. Te escriben por el chat.` : `Que tu teléfono termina en ${ciudadanoTel.slice(-4)}. Escribe un seudónimo para enviar.`)
      : 'Solo “Anónimo”. Ni tu nombre ni tu teléfono.';

  return (
    <form className="d-pantalla d-confirmar" onSubmit={crear} noValidate>
      <div className="d-encabezado">
        <button type="button" className="d-atras" onClick={alVolver} aria-label="Volver a elegir qué pasa"><Icono d={ICONO.atras} /></button>
        <h2><span aria-hidden="true">{emoji}</span> {corto}</h2>
      </div>

      <fieldset className="d-bloque">
        <legend>¿Dónde?</legend>
        <div className="d-chips" role="radiogroup" aria-label="Lugar del reporte">
          {demo.LUGARES_DEMO.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={lugarId === l.id} className={`d-chip ${lugarId === l.id ? 'sel' : ''}`} onClick={() => alLugar(l.id)}>{l.nombre}</button>
          ))}
          <button type="button" role="radio" aria-checked={lugarId === 'gps'} className={`d-chip ${lugarId === 'gps' ? 'sel' : ''}`} onClick={usarGps}><Icono d={ICONO.ubicacion} tam={18} /> Mi ubicación</button>
        </div>
        <p className="suave d-nota" role="status">{lugarId === 'gps' ? gpsEstado || (gps ? 'Usando tu ubicación.' : '') : 'Lugar de prueba de la demo.'}</p>
        {gpsError && (
          <div className="d-error-gps" role="alert" data-testid="error-gps">
            <p>{gpsError}</p>
            <button type="button" className="c-boton-sec" onClick={usarGps}>Reintentar ubicación</button>
          </div>
        )}
      </fieldset>

      {preguntas.length > 0 && (
        <fieldset className="d-bloque">
          <legend>{'Si puedes, contesta (opcional)'}</legend>
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
                <div className="d-opciones" role="group" aria-labelledby={`p-${q.id}`}>
                  {([['1', 1], ['2', 2], ['3 a 5', 4], ['Más de 5', 6]] as const).map(([t, v]) => (
                    <button type="button" key={t} className={`d-opcion ${respuestas[q.id] === v ? 'sel' : ''}`} aria-pressed={respuestas[q.id] === v} onClick={() => responder(q.id, v)}>{t}</button>
                  ))}
                </div>
              ) : (
                <input value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value)} aria-labelledby={`p-${q.id}`} maxLength={200} />
              )}
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className="d-bloque">
        <legend>¿Cómo quieres reportar?</legend>
        <div className="d-segmentos" role="radiogroup" aria-label="Cómo quieres reportar">
          {IDENTIDADES.map(([v, t]) => {
            const bloqueado = v === 'anonimo' && !anonimoPermitido;
            return (
              <button key={v} type="button" role="radio" aria-checked={identidad === v} aria-disabled={bloqueado} className={identidad === v ? 'sel' : ''}
                onClick={() => { if (bloqueado) return; setIdentidad(v); if (v === 'seudonimo') setAlias((x) => x || seudonimoSugerido()); }}>{t}</button>
            );
          })}
        </div>
        {identidad === 'seudonimo' && (
          <label className="d-campo">Seudónimo
            <input ref={aliasRef} value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} placeholder="Por ejemplo: Vecina del 4" />
          </label>
        )}
        <p className="d-vera" data-testid="vera-policia"><strong>La policía verá:</strong><span>{veraLaPolicia}</span></p>
        {!anonimoPermitido && <p className="suave d-nota">Anónimo no está disponible en esta emergencia (robos, agresiones, disparos, violencia o algo que pasa contra una persona): el operador necesita poder contactarte.</p>}
      </fieldset>

      <div className="d-bloque">
        <span className="d-legend">{'Foto (opcional)'}</span>
        <Miniaturas fotos={fotos} alQuitar={(i) => setFotos((f) => f.filter((_, j) => j !== i))} />
        <BotonFoto fotos={fotos.length} alAgregar={(f) => setFotos((x) => [...x, f])} />
      </div>

      <details className="d-bloque d-detalles">
        <summary>{'Agregar detalles (opcional)'}</summary>
        <label className="d-campo">Cuéntanos más
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={300} placeholder="Por ejemplo: dos personas, una con gorra roja" />
        </label>
      </details>

      {error && <ErrorEnvio mensaje={error} alReintentar={() => crear()} />}
      <div className="d-accion-fija">
        <button className="c-boton c-grande c-ancho d-enviar">{enLinea ? 'Enviar reporte' : 'Guardar y enviar al volver la señal'}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mi reporte: cola sin conexión, seguimiento y reportes anteriores
// ---------------------------------------------------------------------------

function PantallaMiReporte({
  folio, folios, cola, enLinea, recienEnviado, alAbrir, alNuevo, alCancelarCola,
}: {
  folio: string | null; folios: string[]; cola: PendienteEnvio<DatosReporte>[]; enLinea: boolean; recienEnviado: string | null;
  alAbrir: (f: string) => void; alNuevo: () => void; alCancelarCola: () => void;
}) {
  const [, setPulso] = useState(0);
  useEffect(() => demo.escuchar(() => setPulso((x) => x + 1)), []);
  const r = folio ? demo.reporte(folio) : undefined;
  // Todos los reportes, el que está en curso primero; luego los más recientes.
  const mios = folios.map((f) => demo.reporte(f)).filter((x): x is ReporteDemo => !!x)
    .sort((a, b) => Number(FINALES.includes(a.estado)) - Number(FINALES.includes(b.estado)) || b.creadoEn.localeCompare(a.creadoEn));

  return (
    <div className="d-pantalla">
      {cola.length > 0 && <EnCola cola={cola} enLinea={enLinea} alCancelar={alCancelarCola} />}
      {r ? (
        <>
          {recienEnviado === r.folio && !cola.length && <p className="aviso-exito" role="status"><span aria-hidden="true">✓</span> Reporte enviado. Ya lo está viendo el centro de atención.</p>}
          <Seguimiento r={r} alNuevo={alNuevo} />
        </>
      ) : !cola.length && (
        <div className="estado c-tarjeta">
          <span className="estado-icono" aria-hidden="true">🛡️</span>
          <h2>Aún no tienes reportes</h2>
          <p>Cuando reportes algo, aquí verás quién te atiende y cuánto falta para que llegue la unidad.</p>
          <button type="button" className="c-boton c-grande" onClick={alNuevo}>Hacer un reporte</button>
        </div>
      )}
      {mios.length > 0 && (
        <section className="c-tarjeta" aria-labelledby="anteriores">
          <h3 id="anteriores">Mis reportes</h3>
          <ul className="d-lista-reportes">
            {mios.map((o) => (
              <li key={o.folio}>
                <button type="button" onClick={() => alAbrir(o.folio)} aria-current={o.folio === folio ? 'true' : undefined} className={o.folio === folio ? 'actual' : ''}>
                  <span><strong data-testid="cnie-lista">{tituloConCodigo(o)}</strong><span className="suave c-pequeno">{o.folio}</span></span>
                  <span className={`c-chip ${FINALES.includes(o.estado) ? 'c-chip-neutro' : ''}`}>{demo.etiquetaCiudadano(o.estado)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EnCola({ cola, enLinea, alCancelar }: { cola: PendienteEnvio<DatosReporte>[]; enLinea: boolean; alCancelar: () => void }) {
  const [ahora, setAhora] = useState(() => Date.now());
  const [intento, setIntento] = useState('');
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const urgente = debeOfrecer911(cola[0], ahora);
  const espera = Math.round((ahora - new Date(cola[0].creadoEn).getTime()) / 1000);
  return (
    <section className="c-tarjeta d-cola" aria-live="polite">
      <h2>{enLinea ? 'Enviando tu reporte…' : 'Sin señal: tu reporte está guardado'}</h2>
      <p>{'Lo guardamos en este teléfono y se enviará solo en cuanto vuelva la señal.'}</p>
      <p className="suave d-nota">{`Esperando ${duracionTexto(espera)} · ${cola.length === 1 ? '1 reporte' : `${cola.length} reportes`} en espera`}</p>
      {urgente && (
        <p className="d-urgente" role="alert">{`No hemos podido enviarlo en ${ESPERA_ANTES_DE_911_SEG} s. Si es una emergencia, `}<strong>llama al 911 ahora</strong>.</p>
      )}
      <a className={`d-boton-911 ${urgente ? 'urgente' : ''}`} href="tel:911"><Icono d={ICONO.telefono} tam={20} /> Llamar al 911</a>
      <button type="button" className="c-boton-sec c-ancho" onClick={() => setIntento(enLinea ? 'Enviando…' : `Seguimos sin señal (${horaLocal(Date.now(), true)}). Se enviará solo en cuanto vuelva.`)}>Reintentar ahora</button>
      {intento && <p className="suave d-nota" role="status" data-testid="reintento">{intento}</p>}
      <button className="c-enlace" onClick={alCancelar}>Cancelar el envío</button>
    </section>
  );
}

function Seguimiento({ r, alNuevo }: { r: ReporteDemo; alNuevo: () => void }) {
  const [texto, setTexto] = useState('');
  const [, setPulso] = useState(0);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  useEffect(() => { const t = setInterval(() => setPulso((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const final = FINALES.includes(r.estado);
  const recomendaciones = demo.recomendacionesPara(r.incidenteId);
  const t = demo.tiemposDe(r);
  const ahora = demo.ahora();
  const escalaEn = r.estado === 'recibido' && !r.folioCad && !r.cadSimulado && r.cadId !== 'c5-queretaro'
    ? Math.max(0, Math.ceil((new Date(r.creadoEn).getTime() + demo.ESPERA_ACUSE_SEG * 1000 - ahora) / 1000))
    : null;
  const u = r.unidad;
  const enSitio = r.estado === 'en_sitio' || r.estado === 'cerrado';

  function enviarMensaje(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    try { demo.mensajeCiudadano(r.folio, texto.trim()); setTexto(''); } catch { /* reporte finalizado */ }
  }

  return (
    <section className="d-seguimiento" aria-label={`Seguimiento del folio ${r.folio}`}>
      <div className="c-tarjeta d-hero">
        <div className="d-hero-fila">
          <span className="suave c-pequeno d-subtitulo"><span data-testid="cnie-seguimiento">{tituloConCodigo(r)}</span>{r.ubicacion.referencia && <span>{`· ${r.ubicacion.referencia}`}</span>}</span>
        </div>
        <p className={`d-estado d-${r.estado}`} data-testid="estado" role="status" aria-live="polite">{demo.etiquetaCiudadano(r.estado)}</p>

        {u && !final && (
          <div className="d-llegada" data-testid="llegada">
            {enSitio
              ? <><span className="d-eta">Ya llegó</span><span>{`${u.etiqueta} está en el lugar`}</span></>
              : <><span className="d-eta">{`Llega en ~${u.etaMinutos ?? '?'} min`}</span><span>{u.etiqueta}{u.distanciaMetros ? ` · a ${u.distanciaMetros < 1000 ? `${Math.round(u.distanciaMetros / 10) * 10} m` : `${(u.distanciaMetros / 1000).toFixed(1)} km`}` : ''}</span></>}
          </div>
        )}
        {escalaEn !== null && (
          <p className="suave d-nota">{`Esperando que un operador lo reciba en la consola. Si nadie lo recibe en ${escalaEn} s, pasa al C5 con el mismo folio. `}<Link href="/consola/" target="_blank" className="d-enlace-bloque">Abrir la consola</Link></p>
        )}

        <Mapa
          reporte={r.ubicacion}
          unidad={u?.lat != null && u.lng != null ? { id: u.unidadId, etiqueta: u.etiqueta, lat: u.lat, lng: u.lng, rumbo: u.rumbo } : null}
          etiquetaReporte="Tu reporte"
          alto={220}
          titulo={u ? `Mapa: ${u.etiqueta} rumbo a tu ubicación` : 'Mapa con la ubicación de tu reporte'}
        />

        <div className="d-folio-caja">
          <span className="suave c-pequeno">Tu folio</span>
          <span className="d-folio" data-testid="folio">{r.folio}</span>
          <span className="suave c-pequeno">{`Atiende ${demo.nombreCad(r.cadId)} · ${r.identidad === 'completa' ? 'con tu nombre' : r.identidad === 'seudonimo' ? `como “${r.alias}”` : 'anónimo'}`}</span>
        </div>

        {r.cadSimulado && <p className="d-nota-demo">Demo automática: la recepción, la unidad y el cierre se simulan para acelerar el recorrido. En el servicio real, el operador cierra el reporte.</p>}
        {r.cerradoPorDemo && <p className="d-nota-demo">Lo cerró la demo automática. En el servicio real lo cierra el operador.</p>}

        {!final && (
          <div className="d-acciones">
            <a className="d-boton-911" href="tel:911"><Icono d={ICONO.telefono} tam={20} /> Llamar al 911</a>
            {confirmarCancelar
              ? <button className="c-boton c-boton-peligro c-grande" onClick={() => { try { demo.cancelar(r.folio); } catch { /* ya finalizado */ } setConfirmarCancelar(false); }}>Sí, cancelar</button>
              : <button className="c-boton-sec c-grande" onClick={() => setConfirmarCancelar(true)}>Cancelar reporte</button>}
          </div>
        )}
      </div>

      {final && <Opinar r={r} />}
      {final && <button className="c-boton c-grande c-ancho" onClick={alNuevo}>Hacer otro reporte</button>}

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
          <p className="d-nota d-linea">
            {`${enSitio ? 'La unidad llegó en' : 'Desde tu reporte:'} ${duracionTexto(t.llegada.segundos)} · meta de llegada ${Math.round(t.llegada.metaSegundos / 60)} min`}
            {t.llegada.estado === 'excedida' && <span className="c-chip c-chip-alerta">Fuera de meta</span>}
          </p>
        )}
      </div>

      {recomendaciones.length > 0 && !final && (
        <div className="c-tarjeta">
          <h3>Mientras llega la unidad</h3>
          <ul className="d-recomendaciones">{recomendaciones.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      <div className="c-tarjeta">
        <h3>Mensajes</h3>
        {!r.mensajes.length && <p className="suave d-nota">Aún no hay mensajes. Si necesitas decir algo, escribe aquí.</p>}
        <ul className="d-mensajes">
          {r.mensajes.map((m) => (
            <li key={m.id} className={m.autor === 'ciudadano' ? 'yo' : ''}>
              <span className="suave">{m.autor === 'ciudadano' ? 'Tú' : m.nombreAutor ?? 'Operador'}</span>
              <p>{m.texto}</p>
            </li>
          ))}
        </ul>
        {!final && (
          <form className="d-chat" onSubmit={enviarMensaje}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe al operador" aria-label="Mensaje al operador" maxLength={300} />
            <button className="c-boton" disabled={!texto.trim()}>Enviar</button>
          </form>
        )}
      </div>

      <div className="c-tarjeta">
        <h3>Fotos</h3>
        <Miniaturas fotos={r.evidencias} />
        {!r.evidencias.length && <p className="suave d-nota">Sin fotos.</p>}
        {!final && <BotonFoto fotos={r.evidencias.length} alAgregar={(f) => { try { demo.agregarFoto(r.folio, f); } catch { /* finalizado */ } }} />}
      </div>

      <details className="c-tarjeta">
        <summary className="d-resumen">Historial</summary>
        <ul className="d-historial">
          {[...r.historial].reverse().map((h, i) => (
            <li key={i} className="d-hito"><span className="suave">{horaLocal(h.en, true)}</span><span>{`${demo.etiquetaCiudadano(h.estado)}${h.nota ? ` · ${h.nota}` : ''}`}</span></li>
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
      <label className="d-campo"><span>{'Comentario o queja (opcional)'}</span><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={500} /></label>
      {error && <p className="c-error" role="alert">{error}</p>}
      <button className="c-boton c-grande c-ancho">Enviar</button>
      <p className="suave d-nota">Si no llegó nadie o calificas con 1 o 2 estrellas, se registra como queja para supervisión.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Perfil: cuenta, apariencia, ajustes de la demo y documentos
// ---------------------------------------------------------------------------

function PantallaPerfil({
  ciudadano, ajustes, alAjustes, simularSinRed, alSimularSinRed, alBorrar,
}: {
  ciudadano: Ciudadano; ajustes: Ajustes; alAjustes: (a: Ajustes) => void; simularSinRed: boolean; alSimularSinRed: (v: boolean) => void; alBorrar: () => void;
}) {
  const [velocidad, setVelocidad] = useState(1);
  useEffect(() => { setVelocidad(demo.velocidad()); return demo.escuchar(() => setVelocidad(demo.velocidad())); }, []);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  return (
    <div className="d-pantalla">
      <section className="c-tarjeta d-cuenta" aria-labelledby="cuenta">
        <span className="d-avatar" aria-hidden="true">{(ciudadano.nombre.trim()[0] ?? '?').toUpperCase()}</span>
        <div>
          <h2 id="cuenta">{ciudadano.nombre}</h2>
          <p className="d-nota" data-testid="mi-telefono">{telefonoLegible(ciudadano.telefono)}</p>
          <p className="suave d-nota">{`Con seudónimo, la policía solo ve que tu teléfono termina en ${ciudadano.telefono.slice(-4)} (${enmascararTelefono(ciudadano.telefono)}).`}</p>
        </div>
      </section>

      <section className="c-tarjeta" aria-labelledby="apariencia">
        <h3 id="apariencia">Apariencia</h3>
        <SelectorTema />
      </section>

      <section className="c-tarjeta d-ajustes" aria-labelledby="ajustes-demo">
        <h3 id="ajustes-demo">Ajustes de la demo</h3>
        <fieldset className="d-sin-borde">
          <legend>¿Quién atiende tus reportes?</legend>
          <label className="d-radio"><input type="radio" name="despacho" checked={!ajustes.automatico} onChange={() => alAjustes({ automatico: false })} /> <span><strong>Un operador en la consola</strong><small>Como en el servicio real. Abre la <Link href="/consola/" target="_blank">consola</Link> con operador / operador.</small></span></label>
          <label className="d-radio"><input type="radio" name="despacho" checked={ajustes.automatico} onChange={() => alAjustes({ automatico: true })} /> <span><strong>Demo automática (acelerada)</strong><small>Se recibe, llega la unidad y se cierra solo, para probar sin otra pestaña.</small></span></label>
        </fieldset>
        <label className="d-fila-ajuste">Velocidad de la simulación
          <select value={velocidad} onChange={(e) => demo.fijarVelocidad(Number(e.target.value))} aria-describedby="nota-velocidad">
            <option value={1}>Real</option>
            <option value={10}>Acelerada ×10</option>
          </select>
        </label>
        <p id="nota-velocidad" className="suave c-pequeno">{`Acelera al CAD simulado y el avance de las unidades. Las horas siempre son las reales de Querétaro. Los reportes de prueba se borran solos a las ${demo.HORAS_DATOS_DEMO} h.`}</p>
        <label className="d-fila-ajuste d-interruptor">Simular sin conexión
          <input type="checkbox" role="switch" checked={simularSinRed} onChange={(e) => alSimularSinRed(e.target.checked)} />
        </label>
        {confirmarBorrar
          ? <div className="d-fila-botones"><button className="c-boton c-boton-peligro" onClick={alBorrar}>Sí, borrar todo</button><button className="c-boton-sec" onClick={() => setConfirmarBorrar(false)}>No</button></div>
          : <button className="c-enlace" onClick={() => setConfirmarBorrar(true)}>Borrar datos de la demo y salir</button>}
      </section>

      <section className="c-tarjeta" aria-labelledby="docs">
        <h3 id="docs">Privacidad y términos</h3>
        <ul className="enlaces-legales">
          <li><Link href="/legal/aviso-privacidad/">Aviso de privacidad</Link></li>
          <li><Link href="/legal/terminos/">Términos y condiciones</Link></li>
        </ul>
      </section>

      <footer className="pie">
        <Logo tam={96} />
        <p>POL-IAQ no sustituye al 911. Si no puedes usar la app, llama al <a href="tel:911">911</a>.</p>
      </footer>
    </div>
  );
}
