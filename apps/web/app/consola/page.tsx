'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './consola.css';
import {
  buscarCnie, duracionTexto, estimarRuta, etiquetaCnie, incidenteCnie, nombreLegible, subtipoPermiteAnonimo, type GrupoCnie, type IncidenteCnie, type TiempoEtapa,
  puedeDespachar, etaSuperaMeta,
  municipioPorClave, NOMBRE_RESPALDO_ESTATAL, TEXTO_ANONIMA_089, UMBRALES_SEMAFORO_PREDETERMINADOS, esMalUso, tipoCnie, type OrdenBandeja,
} from '@pol-iaq/shared/movil';
import { Mapa } from '../../lib/mapa/Mapa';
import { SelectorTema } from '../../lib/tema';
import { Marca } from '../../lib/marca';
import { horaLocal, ZONA_HORARIA } from '../../lib/hora';
import { etiquetaVersion } from '../../lib/version-script';
import * as demo from '../../lib/demo/motor';
import {
  CORPORACION, DEMO, ERRORES, IDENTIDAD, LLEGO, ahoraMs, conectarOperacion, distanciaTexto, ESTADO, ErrorApi, api, esFinal, hace, hora,
  type Accion, type Reporte, type Tablero, type UnidadDisponible, type Yo,
} from './consola';
import { FormUnidad, VistaMunicipios, VistaReportes, VistaSesnsp, tipoDeUnidad } from './municipios';
import { FILTRO_INICIAL, FiltrosBandeja, PuntoPrioridad, RecatalogarMalUso, ResumenBandeja, Semaforo, UmbralesSemaforoForm, semaforoReporte, usarBandeja, type FiltroVista } from './bandeja';
import { Alta911, textoOrigen } from './alta911';

const CLAVE_SESION = 'poliaq.consola.token';

function leerSesion() {
  try { return sessionStorage.getItem(CLAVE_SESION); } catch { return null; }
}
function guardarSesion(t: string | null) {
  try { if (t) sessionStorage.setItem(CLAVE_SESION, t); else sessionStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ }
}
/** Evita que una vista vieja (respuesta HTTP lenta) pise una más nueva. */
const esMasViejo = (v: Reporte, actual?: Reporte) => !!actual && actual.actualizadoEn > v.actualizadoEn;
const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? ERRORES[e.codigo] ?? e.mensaje ?? `Error (${e.codigo})` : 'Sin conexión con el API.');

/**
 * Consola del operador/despachador. Para municipios sin CAD integrado (modo
 * consola) y para supervisión, que ve en solo lectura los CAD con sistema propio.
 */
export default function Consola() {
  const [token, setToken] = useState<string | null>(null);
  const [yo, setYo] = useState<Yo | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const t = leerSesion();
    if (!t) { setListo(true); return; }
    api.yo(t).then((y) => { setToken(t); setYo(y); }).catch(() => guardarSesion(null)).finally(() => setListo(true));
  }, []);

  const salir = useCallback(() => { guardarSesion(null); setToken(null); setYo(null); }, []);

  if (!listo) return <div className="c-centro" aria-busy="true"><div className="esqueleto c-esq-entrar" /><span className="solo-lector">Cargando…</span></div>;
  if (!token || !yo) return <Entrar alEntrar={(t, y) => { guardarSesion(t); setToken(t); setYo(y); }} />;
  return <Mesa token={token} yo={yo} alSalir={salir} />;
}

function Entrar({ alEntrar }: { alEntrar: (token: string, yo: Yo) => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      const { token, ...yo } = await api.sesion(usuario.trim(), clave);
      alEntrar(token, yo);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="c-centro">
      <form className="c-tarjeta c-entrar" onSubmit={enviar}>
        <Marca tam={44} />
        <h1>Consola de operador</h1>
        <p className="suave">Despacho para municipios sin CAD integrado y supervisión.</p>
        <label>Usuario<input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" required /></label>
        <label>Clave<input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="c-error" role="alert">{error}</p>}
        <button className="c-boton c-grande" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        {DEMO && (
          <div className="c-demo c-linea">
            <span>{'Demo con datos de prueba. Usuario: operador. Clave: operador.'}</span>
            <button type="button" className="c-enlace" onClick={() => { setUsuario('operador'); setClave('operador'); }}>Rellenar</button>
            <Link href="/demo/">Crear un reporte</Link>
          </div>
        )}
      </form>
    </div>
  );
}

function Mesa({ token, yo: yoInicial, alSalir }: { token: string; yo: Yo; alSalir: () => void }) {
  const [yo, setYo] = useState(yoInicial);
  const [reportes, setReportes] = useState<Map<string, Reporte>>(new Map());
  const [unidades, setUnidades] = useState<UnidadDisponible[]>([]);
  const [filtro, setFiltro] = useState<FiltroVista>(FILTRO_INICIAL);
  const [orden, setOrden] = useState<OrdenBandeja>('prioridad_demora');
  const [alta, setAlta] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const mesa = useRef<HTMLDivElement>(null);
  const cabecera = useRef<HTMLElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const [enLinea, setEnLinea] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ahora, setAhora] = useState(() => ahoraMs());
  const [vista, setVista] = useState<'bandeja' | 'unidades' | 'tiempos' | 'reportes' | 'sesnsp' | 'municipios'>('bandeja');
  const supervision = yo.operador.cads.includes('*');
  const nombreCad = useCallback((id: string) => yo.cads.find((c) => c.id === id)?.nombre ?? id, [yo.cads]);

  const cargar = useCallback(async () => {
    try {
      // Se cargan también los atendidos: el filtro «Atendidos» y sus contadores los necesitan.
      const [r, u, y] = await Promise.all([api.reportes(token, true), api.unidades(token), api.yo(token)]);
      setYo(y);
      setReportes(new Map(r.reportes.map((x) => [x.folio, x])));
      setUnidades(u.unidades);
      setCargado(true);
      setAviso('');
    } catch (err) {
      if (err instanceof ErrorApi && err.status === 401) alSalir();
      else setAviso(mensajeDe(err));
    }
  }, [token, alSalir]);

  useEffect(() => { void cargar(); }, [cargar]);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  useEffect(() => { const t = setInterval(() => setAhora(ahoraMs()), 1000); return () => clearInterval(t); }, []);

  // Tiempo real: cada cambio llega con la vista completa del reporte.
  useEffect(() => conectarOperacion(token, {
    alEnLinea: setEnLinea,
    alRechazo: alSalir,
    alReporte: (v: Reporte) => {
      setReportes((m) => {
        const n = new Map(m);
        const mio = supervision || yo.operador.cads.includes(v.cadId);
        if (!mio) n.delete(v.folio);
        else if (!esMasViejo(v, m.get(v.folio))) n.set(v.folio, v);
        return n;
      });
      void api.unidades(token).then((u) => setUnidades(u.unidades)).catch(() => {});
    },
    alRecargar: () => { void cargarRef.current(); },
  }), [token, supervision, yo.operador.cads, alSalir]);

  const [cargado, setCargado] = useState(false);
  const [creado, setCreado] = useState('');
  useEffect(() => { if (reportes.size || unidades.length) setCargado(true); }, [reportes, unidades]);
  const umbrales = yo.semaforo ?? UMBRALES_SEMAFORO_PREDETERMINADOS;
  // Operador de un municipio: solo sus CAD (el API ya lo filtra); supervisión filtra por municipio sin salir de la bandeja.
  const todosLosReportes = useMemo(() => [...reportes.values()], [reportes]);
  const { lista, contadores } = usarBandeja(todosLosReportes, filtro, orden, ahora, umbrales);
  const actual = sel ? reportes.get(sel) ?? null : null;
  const nuevos = todosLosReportes.filter((r) => r.estado === 'recibido' && r.operable).length;

  async function actuar(a: Accion) {
    if (!actual) return false;
    setAviso('');
    try {
      const v = await api.accion(token, actual.folio, a);
      // La respuesta puede llegar después de un aviso en tiempo real más nuevo.
      setReportes((m) => (esMasViejo(v, m.get(v.folio)) ? m : new Map(m).set(v.folio, v)));
      return true;
    } catch (err) {
      setAviso(mensajeDe(err));
      if (err instanceof ErrorApi && err.status === 401) alSalir();
      return false;
    }
  }

  // Alturas reales de la cabecera y de la barra de la bandeja (cambian al envolverse): con ellas las
  // columnas usan exactamente el alto restante de la ventana y la lista se desplaza dentro de su columna.
  useEffect(() => {
    const m = mesa.current;
    if (!m || typeof ResizeObserver === 'undefined') return;
    const medir = () => {
      m.style.setProperty('--alto-cabecera', `${cabecera.current?.offsetHeight ?? 0}px`);
      m.style.setProperty('--alto-barra', `${barra.current?.offsetHeight ?? 0}px`);
    };
    const o = new ResizeObserver(medir);
    if (cabecera.current) o.observe(cabecera.current);
    if (barra.current) o.observe(barra.current);
    medir();
    return () => o.disconnect();
  }, [vista]);
  // En móvil el detalle se abre como vista completa: se empieza desde arriba.
  const abrir = (folio: string | null, conAlta = false) => {
    setSel(folio); setAlta(conAlta);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches) window.scrollTo({ top: 0 });
  };
  const filtrosActivos = Number(filtro.estado !== 'activos') + Number(!!filtro.prioridad) + Number(!!filtro.prioridadCnie) + Number(!!filtro.municipio) + Number(!!filtro.demora);

  const misCads = yo.cads.filter((c) => c.mio);
  return (
    <div className="c-mesa" ref={mesa}>
      <header className="c-cabecera" ref={cabecera}>
        <div className="c-cabecera-izq">
          <Marca tam={34} />
          <span className="c-cabecera-titulo">Consola<span className="suave c-ocultable">{` · ${yo.operador.nombre}`}</span></span>
        </div>
        <div className="c-cabecera-der">
          <Reloj />
          <span className={`c-conexion ${enLinea ? 'ok' : ''}`} role="status"><span className="c-punto" aria-hidden="true" />{enLinea ? 'En línea' : 'Reconectando…'}</span>
          <SelectorTema />
          <button className="c-boton-sec c-salir" onClick={alSalir}>Salir</button>
        </div>
      </header>
      <div className="c-subcabecera">
        <span>{supervision ? 'Supervisión: todos los CAD' : misCads.map((c) => c.nombre).join(', ')}</span>
        {misCads.some((c) => c.modo === 'webhook') && <span className="c-chip">Los CAD con sistema propio se ven en solo lectura</span>}
      </div>
      {DEMO && <div className="c-demo c-demo-barra c-linea"><span>{'Demo: el API, el CAD y el GPS de las unidades corren simulados en tu navegador. Nada aquí es una emergencia real.'}</span><Link href="/demo/">Abrir la app ciudadana</Link><Velocidad /><span className="suave" data-testid="version">{etiquetaVersion()}</span></div>}
      <nav className="c-pestanas" aria-label="Vistas de la consola">
        {([['bandeja', 'Bandeja'], ['unidades', 'Unidades (GPS)'], ['tiempos', 'Tiempos y quejas'], ['reportes', 'Reportes por municipio'], ...(supervision ? [['sesnsp', 'SESNSP mensual'], ['municipios', 'Municipios']] as const : [])] as const).map(([v, t]) => (
          <button key={v} className={vista === v ? 'activa' : ''} aria-pressed={vista === v} onClick={() => setVista(v)}>{t}</button>
        ))}
      </nav>
      {creado && <div className="c-nota c-creado" role="status" data-testid="aviso-creado"><span>{creado}</span><button className="c-enlace" onClick={() => setCreado('')}>Cerrar</button></div>}
      {aviso && (
        <div className="c-aviso" role="alert">
          <span>{aviso}</span>
          <span className="c-aviso-acciones">
            <button className="c-boton-sec" onClick={() => void cargar()}>Reintentar</button>
            <button className="c-enlace" onClick={() => setAviso('')}>Cerrar</button>
          </span>
        </div>
      )}

      {vista === 'unidades' && <VistaUnidades unidades={unidades} reportes={lista} nombreCad={nombreCad} form={<FormUnidad token={token} yo={yo} unidades={unidades} alGuardar={() => void cargar()} />} />}
      {vista === 'reportes' && <VistaReportes token={token} yo={yo} ahora={ahora} umbrales={umbrales} />}
      {vista === 'sesnsp' && supervision && <VistaSesnsp token={token} />}
      {vista === 'municipios' && supervision && <VistaMunicipios token={token} alCambio={() => void cargar()} />}
      {vista === 'tiempos' && <VistaTiempos token={token} ahora={ahora} nombreCad={nombreCad} alAbrir={(f) => { setSel(f); setAlta(false); setVista('bandeja'); setFiltro({ ...FILTRO_INICIAL, estado: 'todos' }); }} />}
      {vista === 'bandeja' && <div className="c-barra-bandeja" ref={barra}>
        <h2 className="c-linea">{'Bandeja'}{nuevos > 0 && <span className="c-contador">{`${nuevos} ${nuevos === 1 ? 'nuevo' : 'nuevos'}`}</span>}<span className="suave c-pequeno">{`${lista.length} en la lista`}</span></h2>
        <div className="c-barra-acciones">
          <button type="button" className="c-boton-sec c-boton-filtros" aria-expanded={filtrosAbiertos} aria-controls="franja-filtros" onClick={() => setFiltrosAbiertos((x) => !x)} data-testid="mostrar-filtros">
            {filtrosAbiertos ? 'Ocultar filtros' : 'Filtros'}{filtrosActivos > 0 && <span className="c-filtro-n">{filtrosActivos}</span>}
          </button>
          <button className="c-boton" onClick={() => abrir(null, true)} data-testid="iniciar-reporte">Iniciar nuevo reporte</button>
        </div>
      </div>}
      {vista === 'bandeja' && <div id="franja-filtros" className={`c-franja-filtros ${filtrosAbiertos ? 'abierta' : ''}`}>
        <FiltrosBandeja filtro={filtro} alCambiar={setFiltro} orden={orden} alOrden={setOrden} contadores={contadores} supervision={supervision} umbrales={umbrales} />
        {supervision && <UmbralesSemaforoForm key={`${umbrales.amarillo}-${umbrales.rojo}`} actuales={umbrales} alGuardar={async (u) => { try { await api.fijarUmbrales(token, u); await cargar(); return null; } catch (e) { return mensajeDe(e); } }} />}
      </div>}
      {vista === 'bandeja' && <div className={`c-columnas ${actual || alta ? 'con-detalle' : ''}`}>
        <section className="c-bandeja" aria-label="Bandeja de reportes">
          {!cargado && !aviso && <div aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="esqueleto c-esq-item" />)}<span className="solo-lector">Cargando reportes…</span></div>}
          {cargado && !lista.length && (
            <div className="estado c-tarjeta">
              <span className="estado-icono" aria-hidden="true">✓</span>
              <h3>{todosLosReportes.length ? 'Ningún reporte con estos filtros' : 'Sin reportes por ahora'}</h3>
              <p>{todosLosReportes.length ? 'Quita o cambia un filtro.' : 'Los nuevos aparecen aquí al instante.'}</p>
            </div>
          )}
          <div className="c-lista-bandeja">
          {lista.map((r) => (
            <button key={r.folio} className={`c-item p-${r.prioridad} ${sel === r.folio ? 'sel' : ''} ${esFinal(r.estado) ? 'final' : ''}`} onClick={() => abrir(r.folio)} data-folio={r.folio}>
              <div className="c-fila">
                <span className="c-linea"><PuntoPrioridad p={r.prioridad} cnie={r.cnie?.prioridad} /><strong>{r.incidente}</strong></span>
                <Semaforo s={semaforoReporte(r, ahora, umbrales)} />
              </div>
              <div className="c-etiquetas">
                {r.origen === '911' && <span className="c-chip c-chip-911" data-testid="origen-911">{textoOrigen(r)}</span>}
                {esMalUso(r.cnie?.tipo.codigo) && <span className="c-chip c-chip-alerta">Mal uso</span>}
                {r.asistenciaDirecta && <span className="c-chip c-chip-alerta">Asistencia directa</span>}
                <span className={`c-chip e-${r.estado}`}>{ESTADO[r.estado]}</span>
                <span className="c-chip" title="La que usa POL-IAQ para despachar, según las respuestas">{`Prioridad operativa: ${r.prioridad}`}</span>
                <span className={`c-chip ${r.cnie?.incidente ? '' : 'c-chip-aviso'}`} title="Código y prioridad oficial del CNIE V 3.0">{r.cnie ? `CNIE ${r.cnie.incidente?.codigo ?? r.cnie.subtipo.codigo}${r.cnie.prioridad ? ` · oficial ${r.cnie.prioridad}` : ''}` : 'Sin código CNIE'}</span>
                {!r.operable && <span className="c-chip">Solo lectura</span>}
                {r.automatico && <span className="c-chip c-chip-neutro">Demo automática</span>}
                {r.opinion?.queja && <span className="c-chip c-chip-alerta">Queja</span>}
              </div>
              <div className="suave c-pequeno">{`${r.folio} · ${nombreCad(r.cadId)}${r.municipioClave ? ` · ${municipioPorClave(r.municipioClave)?.nombre ?? r.municipioClave}` : ''} · hace ${hace(r.creadoEn, ahora)}`}</div>
              {r.ruta?.canal === '089' ? <div className="c-pequeno c-respaldo">{TEXTO_ANONIMA_089}</div> : r.respaldo && <div className="c-pequeno c-respaldo">{r.respaldo}</div>}
              {r.escalaAlC5En && <Cuenta hasta={r.escalaAlC5En} ahora={ahora} />}
            </button>
          ))}
          </div>
        </section>

        {alta ? (
          <Alta911 token={token} alCancelar={() => setAlta(false)} alCrear={(r, nuevo) => {
            setReportes((m) => new Map(m).set(r.folio, r));
            setAlta(false); setSel(r.folio); setFiltro(FILTRO_INICIAL);
            setAviso('');
            setCreado(`Folio ${r.folio} creado por llamada al 911${nuevo ? '; el reportante quedó dado de alta' : ''}.`);
          }} />
        ) : actual ? (
          <Detalle key={actual.folio} r={actual} ahora={ahora} unidades={unidades} yo={yo} nombreCad={nombreCad} actuar={actuar} alCerrar={() => setSel(null)} />
        ) : (
          <ResumenBandeja reportes={todosLosReportes} contadores={contadores} ahora={ahora} umbrales={umbrales}
            alFiltrar={(f) => setFiltro(f)} alAbrir={(f) => abrir(f)} alIniciar={() => abrir(null, true)} />
        )}
      </div>}
    </div>
  );
}

function Cuenta({ hasta, ahora }: { hasta: string; ahora: number }) {
  const s = Math.round((new Date(hasta).getTime() - ahora) / 1000);
  return <div className="c-cuenta">{s > 0 ? `Sin acuse: se escala al ${NOMBRE_RESPALDO_ESTATAL} en ${s} s` : `Escalando al ${NOMBRE_RESPALDO_ESTATAL}…`}</div>;
}

function Detalle({
  r, ahora, unidades, yo, nombreCad, actuar, alCerrar,
}: {
  r: Reporte; ahora: number; unidades: UnidadDisponible[]; yo: Yo; nombreCad: (id: string) => string;
  actuar: (a: Accion) => Promise<boolean>; alCerrar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [unidadId, setUnidadId] = useState('');
  const [texto, setTexto] = useState('');
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');

  // El C5 puede mandar unidades de cualquier CAD (coordina a todo el estado).
  const delCad = unidades.filter((u) => puedeDespachar(r.cadId, u.cadId));
  const principal = r.canalizacion.corporaciones[0];
  // Llegada estimada por calles desde el GPS de cada unidad (el API usa ruta real si tiene servicio de rutas).
  const conRuta = delCad.map((u) => ({ u, ruta: u.posicion ? estimarRuta(u.posicion, r.ubicacion) : null }));
  // Primero las libres de la corporación principal, cada grupo de la más cercana a la más lejana.
  const opciones = conRuta.sort((a, b) =>
    Number(!!a.u.ocupadaEn) - Number(!!b.u.ocupadaEn)
    || Number(b.u.corporacion === principal) - Number(a.u.corporacion === principal)
    || (a.ruta?.segundos ?? Infinity) - (b.ruta?.segundos ?? Infinity));
  const sugerida = opciones.find((o) => !o.u.ocupadaEn && o.ruta);

  async function hacer(a: Accion, despues?: () => void) {
    setOcupado(true);
    if (await actuar(a)) despues?.();
    setOcupado(false);
  }

  const puede = (e: Reporte['estado']) => r.transiciones.includes(e);
  const recibir = r.estado === 'recibido' || r.estado === 'transferido';
  // Se puede (re)asignar mientras la unidad no ha salido.
  const puedeAsignar = puede('asignado') || r.estado === 'asignado';
  const final = esFinal(r.estado);
  const mapa = `https://www.openstreetmap.org/?mlat=${r.ubicacion.lat}&mlon=${r.ubicacion.lng}#map=18/${r.ubicacion.lat}/${r.ubicacion.lng}`;
  const unidadMapa = r.unidad?.lat != null && r.unidad.lng != null
    ? { id: r.unidad.unidadId, etiqueta: r.unidad.etiqueta, lat: r.unidad.lat, lng: r.unidad.lng, rumbo: r.unidad.rumbo }
    : null;
  const otras = final ? [] : delCad.filter((u) => u.posicion && u.unidadId !== r.unidad?.unidadId).map((u) => ({ id: u.unidadId, etiqueta: u.etiqueta, lat: u.posicion!.lat, lng: u.posicion!.lng, ocupada: !!u.ocupadaEn }));

  return (
    <section className="c-detalle" aria-label={`Reporte ${r.folio}`}>
      <div className="c-fila">
        <button className="c-boton-sec c-volver" onClick={alCerrar} data-testid="atras">← Atrás</button>
        <span className="suave c-pequeno">{`Actualizado ${hora(r.actualizadoEn)}`}</span>
      </div>
      <div className={`c-tarjeta c-titulo p-${r.prioridad}`}>
        <div className="c-fila">
          <h2>{r.incidente}</h2>
          <span className={`c-chip e-${r.estado}`}>{ESTADO[r.estado]}</span>
        </div>
        <div className="suave">{`${r.folio}${r.folioCad && r.folioCad !== r.folio ? ` · CAD ${r.folioCad}` : ''} · ${nombreCad(r.cadId)} · hace ${hace(r.creadoEn, ahora)}`}</div>
        <div className="c-etiquetas">
          {r.asistenciaDirecta && <span className="c-chip c-chip-alerta">Botón de asistencia directa</span>}
          {r.escenarioId && <span className="c-chip">Acceso rápido de lugar guardado</span>}
          <span className="c-chip" data-testid="municipio-clave" title="Clave INEGI del municipio donde ocurre">{r.municipioClave ? `Municipio ${r.municipioClave} · ${municipioPorClave(r.municipioClave)?.nombre ?? ''}` : 'Fuera de Querétaro'}</span>
          <span className="c-chip" data-testid="prioridad-operativa">{`Prioridad operativa (respuesta): ${r.prioridad}`}</span>
          {r.ruta?.canal === '089' && <span className="c-chip c-chip-aviso" data-testid="canal">{TEXTO_ANONIMA_089}</span>}
          <span className={`c-chip ${r.origen === '911' ? 'c-chip-911' : ''}`} data-testid="origen-detalle">{`Origen: ${textoOrigen(r)}`}</span>
          {r.automatico && <span className="c-chip c-chip-neutro">Demo automática</span>}
        </div>
        {r.respaldo && <p className="c-respaldo" data-testid="respaldo">{r.respaldo}</p>}
        {r.ruta && r.ruta.cadOrigen !== r.cadId && <p className="suave c-pequeno" data-testid="cad-origen">{`Se creó para ${nombreCad(r.ruta.cadOrigen)}; hoy lo atiende ${nombreCad(r.cadId)}.`}</p>}
        {r.cerradoPorDemo && <p className="c-nota c-pequeno">Lo cerró la demo automática para acelerar el recorrido. En el servicio real, el reporte lo cierra el operador con “Cerrar como atendido”.</p>}
        {r.escalaAlC5En && <Cuenta hasta={r.escalaAlC5En} ahora={ahora} />}
      </div>

      <ClasificacionCnie r={r} ocupado={ocupado} hacer={hacer} />
      <RecatalogarMalUso r={r} ocupado={ocupado} hacer={hacer} />

      {r.canalizacion.alertas.length > 0 && (
        <div className="c-alertas">{r.canalizacion.alertas.map((a) => <span key={a} className="c-chip c-chip-alerta">{a}</span>)}</div>
      )}

      <div className="c-rejilla">
        <div className="c-tarjeta">
          <h3>Canalización sugerida</h3>
          <ol className="c-lista">{r.canalizacion.corporaciones.map((c, i) => <li key={c}>{`${CORPORACION[c] ?? c} ${i === 0 ? '(principal)' : '(apoyo)'}`}</li>)}</ol>
        </div>
        <div className="c-tarjeta">
          <h3>Reportante</h3>
          {r.reportante ? (
            <>
              <div className="c-linea"><span>{r.reportante.identidad === 'anonimo' ? TEXTO_ANONIMA_089 : r.reportante.nombre}</span>{r.reportante.identidad && r.reportante.identidad !== 'completa' && <span className="c-chip">{IDENTIDAD[r.reportante.identidad]}</span>}</div>
              {r.reportante.identidad === 'completa' || !r.reportante.identidad
                ? <a href={`tel:${r.reportante.telefono}`}>{r.reportante.telefono}</a>
                : <div className="suave c-pequeno" data-testid="telefono-oculto">{`${r.reportante.telefono ? `Teléfono oculto, termina en ${r.reportante.telefono.slice(-4)}` : 'Sin teléfono'}. Contesta por el chat del folio.`}</div>}
              <div className="suave c-pequeno">{`Confiabilidad ${Math.round(r.reportante.confiabilidad * 100)}%`}</div>
            </>
          ) : <div className="suave">No disponible</div>}
        </div>
        <div className="c-tarjeta">
          <h3>Ubicación</h3>
          {r.ubicacion.referencia && <div>{r.ubicacion.referencia}</div>}
          <div className="suave c-pequeno">{r.ubicacion.lat.toFixed(5)}, {r.ubicacion.lng.toFixed(5)}{r.ubicacion.precisionMetros ? ` · ±${Math.round(r.ubicacion.precisionMetros)} m` : ''}</div>
          <a href={mapa} target="_blank" rel="noreferrer">Abrir en OpenStreetMap</a>
        </div>
      </div>

      <div className="c-tarjeta">
        <div className="c-fila">
          <h3>Mapa en vivo</h3>
          {r.unidad && <span className="suave c-pequeno">{`${r.unidad.etiqueta}${r.unidad.distanciaMetros != null && r.unidad.distanciaMetros > 0 ? ` a ${distanciaTexto(r.unidad.distanciaMetros)}` : ''}${r.unidad.etaMinutos ? ` · llega en ~${r.unidad.etaMinutos} min` : r.estado === 'en_sitio' ? ' · en el lugar' : ''}`}</span>}
        </div>
        {r.unidad?.etaMinutos != null && !final && r.estado !== 'en_sitio' && etaSuperaMeta(Math.ceil((r.tiempos.llegada.segundos ?? 0) / 60) + r.unidad.etaMinutos, r.tiempos.llegada.metaSegundos) && (
          <p className="c-aviso-meta" role="alert" data-testid="eta-meta">{`La llegada estimada (~${r.unidad.etaMinutos} min más) supera la meta de llegada (${Math.round(r.tiempos.llegada.metaSegundos / 60)} min). Busca una unidad más cercana o pide apoyo a otra corporación.`}</p>
        )}
        <Mapa reporte={r.ubicacion} unidad={unidadMapa} unidades={otras} alto={240} titulo={`Mapa del reporte ${r.folio}${r.unidad ? ` con ${r.unidad.etiqueta}` : ''}`} />
        {!final && <p className="suave c-pequeno c-leyenda c-linea"><span><span className="c-punto-l asignada" />{'asignada'}</span><span><span className="c-punto-l libre" />{'libre'}</span><span><span className="c-punto-l ocupada" />{'ocupada'}</span></p>}
      </div>

      <Tiempos t={r.tiempos} />

      {r.operable && !final && (
        <div className="c-tarjeta c-acciones">
          <h3>Despacho</h3>
          {r.automatico && <p className="c-nota c-pequeno">La demo automática está llevando este reporte. Si haces cualquier acción, tomas el control y la demo deja de avanzarlo sola.</p>}
          {recibir && (
            <>
              <button className="c-boton c-grande c-ancho" disabled={ocupado} onClick={() => hacer({ accion: 'recibir' })}>Recibir reporte</button>
              <p className="suave c-pequeno">Al recibirlo, el sistema asigna solo la unidad libre más cercana por ruta.</p>
            </>
          )}
          {!recibir && puedeAsignar && !r.unidad && (
            <>
              <p className="c-nota c-pequeno">No había una unidad libre cuando se recibió. Asígnala en cuanto se libere una.</p>
              {sugerida && (
                <button className="c-boton c-grande c-ancho" disabled={ocupado} onClick={() => hacer({ accion: 'asignar_cercana' })}>
                  {`Asignar la más cercana: ${sugerida.u.etiqueta} · ${distanciaTexto(sugerida.ruta!.metros)} · ~${Math.max(1, Math.ceil(sugerida.ruta!.segundos / 60))} min`}
                </button>
              )}
            </>
          )}
          {!recibir && puedeAsignar && (
            <details className="c-reasignar" open={!r.unidad}>
              <summary>{r.unidad ? 'Reasignar unidad' : 'Elegir otra unidad'}</summary>
              {r.unidad && <p className="suave c-pequeno">La unidad se asignó sola por cercanía. Cambia de unidad solo si hace falta (por ejemplo, si la asignada no puede ir).</p>}
              <div className="c-form">
                <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} aria-label={r.unidad ? 'Reasignar a otra unidad' : 'Elegir otra unidad'}>
                  <option value="">Elige una unidad…</option>
                  {opciones.map(({ u, ruta }) => (
                    <option key={u.unidadId} value={u.unidadId} disabled={!!u.ocupadaEn}>
                      {`${u.etiqueta} · ${CORPORACION[u.corporacion] ?? u.corporacion}${ruta ? ` · ${distanciaTexto(ruta.metros)} · ~${Math.max(1, Math.ceil(ruta.segundos / 60))} min` : ' · sin GPS'}${u.ocupadaEn ? ` (ocupada en ${u.ocupadaEn})` : ''}`}
                    </option>
                  ))}
                </select>
                <button className="c-boton" disabled={ocupado || !unidadId} onClick={() => hacer({ accion: 'asignar', unidadId }, () => setUnidadId(''))}>{r.unidad ? 'Reasignar' : 'Asignar'}</button>
              </div>
              <p className="suave c-pequeno">El tiempo de llegada se calcula por ruta desde el GPS de la unidad; no se escribe a mano.</p>
            </details>
          )}
          <div className="c-botones">
            {!recibir && puede('en_camino') && <button className="c-boton-sec" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'en_camino' })}>En camino</button>}
            {!recibir && puede('en_sitio') && <button className="c-boton-sec" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'en_sitio' })}>Unidad en sitio</button>}
            {puede('cerrado') && <button className={r.estado === 'en_sitio' ? 'c-boton' : 'c-boton-sec'} disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'cerrado', nota: 'Atendido por el operador' })}>Cerrar como atendido</button>}
            {puede('improcedente') && <button className="c-boton-sec c-peligro" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'improcedente' })}>Improcedente</button>}
          </div>
          {puede('transferido') && (
            <div className="c-form">
              <select value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="CAD destino">
                <option value="">Transferir a…</option>
                {yo.cads.filter((c) => c.id !== r.cadId && c.conectado).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <input placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
              <button className="c-boton-sec" disabled={ocupado || !destino} onClick={() => hacer({ accion: 'transferir', cadDestinoId: destino, ...(motivo && { motivo }) })}>Transferir</button>
            </div>
          )}
        </div>
      )}
      {!r.operable && !final && <p className="c-nota">Este CAD despacha en su propio sistema. Aquí ves el reporte en tiempo real, pero las acciones se hacen en el CAD.</p>}

      <div className="c-tarjeta">
        <div className="c-fila">
          <h3>Cuestionario de la despachadora virtual</h3>
        </div>
        {r.descripcion && <p><strong>Relato:</strong> {r.descripcion}</p>}
        <pre className="c-transcripcion">{sinCabecera(r.cuestionario.transcripcion) || 'Sin respuestas todavía.'}</pre>
        {r.cuestionario.pendientes.length > 0 && (
          <>
            <h4>Faltan por preguntar</h4>
            <ul className="c-lista">{r.cuestionario.pendientes.map((p) => <li key={p}>{p}</li>)}</ul>
          </>
        )}
        {r.recomendaciones.length > 0 && (
          <>
            <h4>Indicaciones que recibió el ciudadano</h4>
            <ul className="c-lista">{r.recomendaciones.map((p) => <li key={p}>{p}</li>)}</ul>
          </>
        )}
      </div>

      {r.opinion && (
        <div className={`c-tarjeta ${r.opinion.queja ? 'c-queja' : ''}`}>
          <h3>{r.opinion.queja ? 'Queja del ciudadano' : 'Calificación del ciudadano'}</h3>
          <div className="c-linea"><span aria-label={`${r.opinion.calificacion} de 5`}>{'★'.repeat(r.opinion.calificacion) + '☆'.repeat(5 - r.opinion.calificacion)}</span><span>{`· ${LLEGO[r.opinion.llegoUnidad]}`}</span></div>
          {r.opinion.comentario && <p className="c-cita">“{r.opinion.comentario}”</p>}
          <div className="suave c-pequeno">{hora(r.opinion.en)}</div>
        </div>
      )}

      {r.evidencias.length > 0 && (
        <div className="c-tarjeta">
          <h3>Evidencia</h3>
          <ul className="c-evidencias">
            {r.evidencias.map((e) => (
              <li key={e.id}>
                {e.url.startsWith('data:image/') ? <a href={e.url} target="_blank" rel="noreferrer"><img src={e.url} alt={`Foto del reporte ${r.folio}`} /></a> : <a href={e.url} target="_blank" rel="noreferrer">{e.tipo}</a>}
                <span className="c-pequeno c-linea"><span className="suave">Huella SHA-256</span><code className="c-hash" data-testid="hash-consola">{e.sha256}</code>{e.expiraEn ? <span className="suave">{`· enlace vence ${hora(e.expiraEn)}`}</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="c-tarjeta">
        <h3>Chat con el ciudadano</h3>
        <div className="c-chat">
          {!r.mensajes.length && <div className="suave">Sin mensajes.</div>}
          {r.mensajes.map((m) => (
            <div key={m.id} className={`c-msj ${m.autor}`}>
              <div className="c-pequeno suave">{m.autor === 'ciudadano' ? 'Ciudadano' : m.nombreAutor ?? 'Operador'} · {hora(m.en)}</div>
              {m.texto}
            </div>
          ))}
        </div>
        {r.operable && !final && (
          <form className="c-form" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) void hacer({ accion: 'mensaje', texto: texto.trim() }, () => setTexto('')); }}>
            <input placeholder="Escribe al ciudadano…" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} />
            <button className="c-boton" disabled={ocupado || !texto.trim()}>Enviar</button>
          </form>
        )}
      </div>

      <div className="c-tarjeta">
        <h3>Historial</h3>
        <ul className="c-lista">{r.historial.map((h, i) => <li key={i}>{`${hora(h.en)} · ${ESTADO[h.estado]}${h.nota ? ` (${h.nota})` : ''}`}</li>)}</ul>
      </div>
    </section>
  );
}

/** La versión del protocolo queda en el folio; al operador solo se le muestran las respuestas. */
const sinCabecera = (t: string) => (t.startsWith('Cuestionario protocolo') ? t.split('\n').slice(1).join('\n') : t);

const ESTADO_ETAPA: Record<TiempoEtapa['estado'], string> = {
  cumplida: 'En meta', excedida: 'Fuera de meta', en_curso: 'En curso', en_riesgo: 'Por vencer', pendiente: 'Pendiente', omitida: '—',
};

const ORIGEN_CNIE: Record<string, string> = {
  catalogo: 'Código de la opción que eligió el ciudadano',
  respuestas: 'Afinado con lo que contestó el ciudadano',
  ciudadano: 'Elegido por el ciudadano en el catálogo completo',
  operador: 'Corregido por un operador',
};

/**
 * Clasificación CNIE V 3.0 del folio: etiqueta completa, las dos prioridades
 * (CNIE y operativa) y la corrección del código, que queda en la bitácora.
 */
function ClasificacionCnie({ r, ocupado, hacer }: { r: Reporte; ocupado: boolean; hacer: (a: Accion, despues?: () => void) => Promise<void> }) {
  const [busqueda, setBusqueda] = useState('');
  const [elegido, setElegido] = useState<IncidenteCnie | null>(null);
  const [motivo, setMotivo] = useState('');
  const [abierto, setAbierto] = useState(!r.cnie?.incidente);
  // Mal Uso (tipo 7) tiene su propia acción, con motivo obligatorio.
  const resultados = useMemo(() => buscarCnie(busqueda, 8).filter((i) => !esMalUso(i.codigo)), [busqueda]);
  const c = r.cnie;
  const difiere = c?.prioridad && c.prioridad.toLowerCase() !== r.prioridad;
  // Un reporte anónimo que se reclasifica a un subtipo que no admite anónimo: no se puede devolver la llamada.
  const anonimoFuera = r.reportante?.identidad === 'anonimo' && c && !subtipoPermiteAnonimo(c.subtipo.codigo) && c.origen === 'operador';
  const vistaPrevia = elegido ? etiquetaCnie({ tipo: elegido.tipo, subtipo: elegido.subtipo, incidente: elegido, prioridad: elegido.prioridad }) : '';

  return (
    <div className="c-tarjeta c-cnie" data-testid="cnie">
      <div className="c-fila">
        <h3>Clasificación CNIE</h3>
        <span className="suave c-pequeno">{`V ${c?.version ?? '3.0'}`}</span>
      </div>
      {c ? (
        <>
          <p className="c-cnie-etiqueta" data-testid="cnie-etiqueta">{r.cnieEtiqueta}</p>
          <div className="c-etiquetas">
            {c.prioridad && <span className={`c-chip ${c.prioridad === 'ALTA' ? 'c-chip-alerta' : ''}`} data-testid="prioridad-cnie">{`Prioridad CNIE (oficial): ${c.prioridad}`}</span>}
            <span className="c-chip">{`Prioridad operativa (respuesta): ${r.prioridad}`}</span>
            {c.secundario && <span className="c-chip" title={nombreLegible(c.secundario.nombre)}>{`Secundario ${c.secundario.codigo} · ${nombreLegible(c.secundario.nombre)}`}</span>}
          </div>
          {difiere && <p className="suave c-pequeno" data-testid="prioridades-nota">{'No es un error que difieran: la prioridad CNIE es la oficial del catálogo nacional para este tipo de incidente; la operativa es la que usa POL-IAQ para despachar según lo que contestó el ciudadano (armas, heridos, si sigue ocurriendo). Las dos se guardan.'}</p>}
          <p className="suave c-pequeno">{`${ORIGEN_CNIE[c.origen]}${!c.incidente ? '. Falta el incidente: elígelo abajo.' : '.'}`}</p>
        </>
      ) : (
        <p className="c-nota c-pequeno">Sin código CNIE. El ciudadano eligió “Otra emergencia”: asígnale el incidente que corresponda.</p>
      )}
      {anonimoFuera && <p className="c-nota c-pequeno">El reporte llegó como anónimo y este subtipo normalmente no lo admite. Contesta por el chat del folio.</p>}

      {r.operable && (
        <details className="c-reasignar" open={abierto} onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}>
          <summary>{c?.incidente ? 'Corregir código' : 'Asignar código'}</summary>
          <label className="c-campo">Busca por nombre o código
            <input type="search" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setElegido(null); }} placeholder="Ej. robo negocio, riña, 30202" data-testid="cnie-buscar" autoComplete="off" />
          </label>
          {busqueda.trim() && !elegido && (
            resultados.length ? (
              <ul className="c-cnie-resultados" role="listbox" aria-label="Incidentes del CNIE">
                {resultados.map((i) => (
                  <li key={i.codigo}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setElegido(i)}>
                      <span className="c-linea"><strong>{i.codigo}</strong><span>{nombreLegible(i.nombre)}</span></span>
                      <span className="suave c-pequeno">{`${i.tipo.nombre} / ${i.subtipo.nombreCorto} · ${i.prioridad}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="suave c-pequeno">Sin resultados. Los códigos dados de baja en el CNIE V 3.0 no se pueden usar.</p>
          )}
          {elegido && (
            <div className="c-cnie-elegido">
              <p><strong>Nuevo:</strong> {vistaPrevia}</p>
              <input placeholder="Motivo de la corrección (queda en la bitácora)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} aria-label="Motivo de la corrección" />
              <div className="c-botones">
                <button className="c-boton" disabled={ocupado || elegido.codigo === c?.incidente?.codigo} onClick={() => hacer({ accion: 'reclasificar', codigoCnie: elegido.codigo, ...(motivo.trim() && { motivo: motivo.trim() }) }, () => { setElegido(null); setBusqueda(''); setMotivo(''); setAbierto(false); })}>Guardar código</button>
                <button className="c-boton-sec" onClick={() => setElegido(null)}>Cambiar</button>
              </div>
            </div>
          )}
        </details>
      )}

      {r.correccionesCnie.length > 0 && (
        <>
          <h4>Correcciones (bitácora)</h4>
          <ul className="c-lista c-pequeno" data-testid="cnie-correcciones">
            {r.correccionesCnie.map((x) => (
              <li key={x.en + x.a}>{hora(x.en)} · {x.de ?? 'sin código'} → <strong>{x.a}</strong> {incidenteCnie(x.a) ? `(${nombreLegible(incidenteCnie(x.a)!.nombre)})` : ''}{x.tipoA && x.tipoDe !== x.tipoA ? ` · tipo ${x.tipoDe ?? '—'} → ${x.tipoA} ${tipoCnie(x.tipoA)?.nombre ?? ''}` : ''} · {x.actor.replace(/^operador:/, '')}{x.motivo ? ` · “${x.motivo}”` : ''}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TablaCnie({ titulo, grupos }: { titulo: string; grupos: GrupoCnie[] }) {
  return (
    <div className="c-tabla-desliza">
    <table className="c-tiempos" aria-label={titulo}>
      <thead><tr><th scope="col">{titulo}</th><th scope="col">Reportes</th><th scope="col">Quejas</th><th scope="col">Llegada promedio</th><th scope="col">En meta</th></tr></thead>
      <tbody>
        {grupos.map((g) => (
          <tr key={g.codigo}>
            <th scope="row">{g.codigo === 'sin' ? g.nombre : `${g.codigo} ${g.nombre}`}</th>
            <td>{g.reportes}</td>
            <td>{g.quejas ? <span className="c-chip c-chip-alerta">{g.quejas}</span> : 0}</td>
            <td>{g.llegada.promedioSegundos == null ? '—' : duracionTexto(g.llegada.promedioSegundos)}</td>
            <td>{g.llegada.enMeta == null ? '—' : <span className={`c-chip ${g.llegada.enMeta >= 90 ? 'c-chip-ok' : g.llegada.enMeta >= 70 ? 'c-chip-aviso' : 'c-chip-alerta'}`}>{`${g.llegada.enMeta}%`}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function Tiempos({ t }: { t: Reporte['tiempos'] }) {
  return (
    <div className="c-tarjeta">
      <div className="c-fila">
        <h3>Tiempos de respuesta</h3>
      </div>
      <table className="c-tiempos">
        <thead><tr><th scope="col">Etapa</th><th scope="col">Tiempo</th><th scope="col">Meta</th><th scope="col">Estado</th></tr></thead>
        <tbody>
          {t.etapas.map((e) => (
            <tr key={e.id} className={`t-${e.estado}`}>
              <th scope="row">{e.nombre}</th>
              <td>{e.segundos == null ? '—' : duracionTexto(e.segundos)}</td>
              <td>{duracionTexto(e.metaSegundos)}</td>
              <td><span className={`c-chip t-chip-${e.estado}`}>{e.simultanea ? 'Mismo paso que la anterior' : ESTADO_ETAPA[e.estado]}</span></td>
            </tr>
          ))}
          <tr className={`t-${t.llegada.estado} c-total`}>
            <th scope="row">Llegada total</th>
            <td>{t.llegada.segundos == null ? '—' : duracionTexto(t.llegada.segundos)}</td>
            <td>{duracionTexto(t.llegada.metaSegundos)}</td>
            <td><span className={`c-chip t-chip-${t.llegada.estado}`}>{ESTADO_ETAPA[t.llegada.estado]}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Todas las unidades con su GPS (AVL) en el mapa. */
function VistaUnidades({ unidades, reportes, nombreCad, form }: { unidades: UnidadDisponible[]; reportes: Reporte[]; nombreCad: (id: string) => string; form?: React.ReactNode }) {
  const [cad, setCad] = useState('');
  const visibles = unidades.filter((u) => (!cad || u.cadId === cad) && u.activa !== false);
  const cads = [...new Set(unidades.map((u) => u.cadId))];
  const activos = reportes.filter((r) => !esFinal(r.estado) && (!cad || r.cadId === cad));
  return (
    <section className="c-panel" aria-label="Unidades con GPS">
      <div className="c-fila">
        <h2>Unidades (GPS en vivo)</h2>
        <select value={cad} onChange={(e) => setCad(e.target.value)} aria-label="Filtrar por CAD">
          <option value="">Todos los CAD</option>
          {cads.map((c) => <option key={c} value={c}>{nombreCad(c)}</option>)}
        </select>
      </div>
      {form}
      <Mapa
        reporte={activos[0]?.ubicacion ?? null}
        etiquetaReporte={activos[0] ? `${activos[0].incidente} (${activos[0].folio})` : undefined}
        unidades={visibles.filter((u) => u.posicion).map((u) => ({ id: u.unidadId, etiqueta: u.etiqueta, lat: u.posicion!.lat, lng: u.posicion!.lng, ocupada: !!u.ocupadaEn }))}
        alto={360}
        titulo="Mapa con la posición GPS de las unidades"
      />
      <div className="c-tabla-desliza">
      <table className="c-tiempos c-unidades">
        <thead><tr><th scope="col">Unidad</th><th scope="col">CAD</th><th scope="col">Estado</th><th scope="col">GPS</th></tr></thead>
        <tbody>
          {visibles.map((u) => (
            <tr key={u.unidadId}>
              <th scope="row">{u.etiqueta}<div className="suave c-pequeno">{`${tipoDeUnidad(u.tipo)} · ${CORPORACION[u.corporacion] ?? u.corporacion}`}</div></th>
              <td>{nombreCad(u.cadId)}</td>
              <td>{u.ocupadaEn ? <span className="c-chip">{`Atiende ${u.ocupadaEn}`}</span> : <span className="c-chip c-chip-ok">Libre</span>}</td>
              <td className="c-pequeno">{u.posicion ? `${u.posicion.lat.toFixed(4)}, ${u.posicion.lng.toFixed(4)}` : 'Sin señal'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

/** Tablero: tiempo por etapa contra su meta, cumplimiento, calificaciones y quejas. */
function VistaTiempos({ token, ahora, nombreCad, alAbrir }: { token: string; ahora: number; nombreCad: (id: string) => string; alAbrir: (folio: string) => void }) {
  const [t, setT] = useState<Tablero | null>(null);
  const [error, setError] = useState('');
  const cada5 = Math.floor(ahora / 5000);
  useEffect(() => { api.tiempos(token).then(setT).catch((e) => setError(mensajeDe(e))); }, [token, cada5]);
  if (error) return <div className="c-panel"><div className="estado estado-error" role="alert"><h3>No se pudo cargar el tablero</h3><p>{error}</p><button className="c-boton" onClick={() => { setError(''); api.tiempos(token).then(setT).catch((e) => setError(mensajeDe(e))); }}>Reintentar</button></div></div>;
  if (!t) return <div className="c-panel" aria-busy="true"><div className="c-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="esqueleto c-esq-kpi" />)}</div><div className="esqueleto c-esq-tabla" /><span className="solo-lector">Cargando tablero…</span></div>;
  const quejas = t.reportes.filter((r) => r.opinion?.queja);
  return (
    <section className="c-panel" aria-label="Tablero de tiempos de respuesta">
      <div className="c-fila">
        <h2>Tiempos de respuesta</h2>
      </div>
      <div className="c-kpis">
        <div className="c-kpi"><strong>{t.reportes.length}</strong><span>reportes</span></div>
        <div className="c-kpi"><strong>{t.resumen.find((x) => x.id === 'llegada')?.enMeta ?? '—'}{t.resumen.find((x) => x.id === 'llegada')?.enMeta != null ? '%' : ''}</strong><span>llegadas en meta</span></div>
        <div className="c-kpi"><strong>{t.calificacionPromedio ?? '—'}</strong><span>calificación (1 a 5)</span></div>
        <div className={`c-kpi ${t.quejas ? 'alerta' : ''}`}><strong>{t.quejas}</strong><span>quejas</span></div>
      </div>
      <div className="c-tarjeta">
        <div className="c-tabla-desliza">
        <table className="c-tiempos">
          <thead><tr><th scope="col">Etapa</th><th scope="col">Promedio</th><th scope="col">Mediana</th><th scope="col">Meta (alta / media / baja)</th><th scope="col">En meta</th></tr></thead>
          <tbody>
            {t.resumen.map((x) => {
              const metas = x.id === 'llegada' ? t.metas.llegada : t.metas.etapas[x.id];
              return (
                <tr key={x.id}>
                  <th scope="row">{x.nombre}<div className="suave c-pequeno">{`${x.n} ${x.n === 1 ? 'medido' : 'medidos'}${x.sinMedir ? ` · ${x.sinMedir} en el mismo paso que la etapa anterior, sin tiempo propio` : ''}`}</div></th>
                  <td>{x.promedioSegundos == null ? '—' : duracionTexto(x.promedioSegundos)}</td>
                  <td>{x.medianaSegundos == null ? '—' : duracionTexto(x.medianaSegundos)}</td>
                  <td className="c-pequeno">{`${duracionTexto(metas.alta)} / ${duracionTexto(metas.media)} / ${duracionTexto(metas.baja)}`}</td>
                  <td>{x.enMeta == null ? '—' : <span className={`c-chip ${x.enMeta >= 90 ? 'c-chip-ok' : x.enMeta >= 70 ? 'c-chip-aviso' : 'c-chip-alerta'}`}>{`${x.enMeta}%`}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
      <div className="c-tarjeta" data-testid="tablero-cnie">
        <h3>Por tipo y subtipo del CNIE</h3>
        {t.reportes.length ? (
          <div className="c-rejilla c-rejilla-cnie">
            <TablaCnie titulo="Tipo" grupos={t.porCnie.tipos} />
            <TablaCnie titulo="Subtipo" grupos={t.porCnie.subtipos} />
          </div>
        ) : <p className="suave">Aún no hay reportes.</p>}
      </div>
      <div className="c-tarjeta">
        <h3>Quejas y calificaciones</h3>
        {!t.reportes.some((r) => r.opinion) && <p className="suave">Aún no hay calificaciones. El ciudadano califica cuando su reporte termina.</p>}
        <ul className="c-lista-plana">
          {[...quejas, ...t.reportes.filter((r) => r.opinion && !r.opinion.queja)].map((r) => (
            <li key={r.folio}>
              <div className="c-linea">
                <button className="c-enlace" onClick={() => alAbrir(r.folio)}>{r.folio}</button>
                <span>{`· ${nombreCad(r.cadId)} · ${'★'.repeat(r.opinion!.calificacion)}${'☆'.repeat(5 - r.opinion!.calificacion)} · ${LLEGO[r.opinion!.llegoUnidad]}`}</span>
                {r.opinion!.queja && <span className="c-chip c-chip-alerta">Queja</span>}
              </div>
              {r.opinion!.comentario && <div className="suave c-pequeno">{`“${r.opinion!.comentario}”`}</div>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Hora actual de Querétaro (America/Mexico_City) en el encabezado; se actualiza cada segundo. */
function Reloj() {
  const [ahora, setAhora] = useState<number | null>(null);
  useEffect(() => { setAhora(Date.now()); const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (ahora === null) return null;
  return (
    <time className="c-reloj" dateTime={new Date(ahora).toISOString()} data-testid="reloj" title={`Hora actual de Querétaro (${ZONA_HORARIA})`}>
      {`${horaLocal(ahora, true)} · Querétaro`}
    </time>
  );
}

/** Velocidad del reloj de la demo (×1 tiempo real, ×10 acelerado). */
function Velocidad() {
  const [v, setV] = useState(1);
  useEffect(() => { setV(demo.velocidad()); return demo.escuchar(() => setV(demo.velocidad())); }, []);
  return (
    <label className="c-velocidad">{'Simulación: '}
      <select value={v} onChange={(e) => demo.fijarVelocidad(Number(e.target.value))} aria-label="Velocidad de la demo">
        <option value={1}>real (×1)</option>
        <option value={10}>acelerado (×10)</option>
      </select>
    </label>
  );
}
