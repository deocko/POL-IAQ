'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './consola.css';
import { duracionTexto, estimarRuta, type TiempoEtapa } from '@pol-iaq/shared/movil';
import { Mapa } from '../../lib/mapa/Mapa';
import { SelectorTema } from '../../lib/tema';
import * as demo from '../../lib/demo/motor';
import {
  CORPORACION, DEMO, ERRORES, IDENTIDAD, LLEGO, ahoraMs, conectarOperacion, distanciaTexto, ESTADO, ErrorApi, api, esFinal, hace, hora, ordenar,
  type Accion, type Reporte, type Tablero, type UnidadDisponible, type Yo,
} from './consola';

const CLAVE_SESION = 'poliaq.consola.token';

function leerSesion() {
  try { return sessionStorage.getItem(CLAVE_SESION); } catch { return null; }
}
function guardarSesion(t: string | null) {
  try { if (t) sessionStorage.setItem(CLAVE_SESION, t); else sessionStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ }
}
/** Evita que una vista vieja (respuesta HTTP lenta) pise una más nueva. */
const esMasViejo = (v: Reporte, actual?: Reporte) => !!actual && actual.actualizadoEn > v.actualizadoEn;
const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? ERRORES[e.codigo] ?? `Error (${e.codigo})` : 'Sin conexión con el API.');

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

  if (!listo) return <div className="c-centro">Cargando…</div>;
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
        <h1>Consola de operador</h1>
        <p className="suave">Pol-IAQ · despacho para municipios sin CAD integrado y supervisión.</p>
        <label>Usuario<input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" required /></label>
        <label>Clave<input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="c-error" role="alert">{error}</p>}
        <button className="c-boton" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        {DEMO && (
          <p className="c-demo">
            Demo con datos de prueba. Usuario <code>operador</code>, clave <code>operador</code>.{' '}
            <button type="button" className="c-enlace" onClick={() => { setUsuario('operador'); setClave('operador'); }}>Rellenar</button>
            {' · '}<Link href="/demo/">Crear un reporte</Link>
          </p>
        )}
      </form>
    </div>
  );
}

function Mesa({ token, yo, alSalir }: { token: string; yo: Yo; alSalir: () => void }) {
  const [reportes, setReportes] = useState<Map<string, Reporte>>(new Map());
  const [unidades, setUnidades] = useState<UnidadDisponible[]>([]);
  const [todos, setTodos] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [enLinea, setEnLinea] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ahora, setAhora] = useState(() => ahoraMs());
  const [vista, setVista] = useState<'bandeja' | 'unidades' | 'tiempos'>('bandeja');
  const supervision = yo.operador.cads.includes('*');
  const nombreCad = useCallback((id: string) => yo.cads.find((c) => c.id === id)?.nombre ?? id, [yo.cads]);

  const cargar = useCallback(async () => {
    try {
      const [r, u] = await Promise.all([api.reportes(token, todos), api.unidades(token)]);
      setReportes(new Map(r.reportes.map((x) => [x.folio, x])));
      setUnidades(u.unidades);
    } catch (err) {
      if (err instanceof ErrorApi && err.status === 401) alSalir();
      else setAviso(mensajeDe(err));
    }
  }, [token, todos, alSalir]);

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

  const lista = useMemo(() => [...reportes.values()].filter((r) => todos || !esFinal(r.estado)).sort(ordenar), [reportes, todos]);
  const actual = sel ? reportes.get(sel) ?? null : null;
  const nuevos = lista.filter((r) => r.estado === 'recibido' && r.operable).length;

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

  const misCads = yo.cads.filter((c) => c.mio);
  return (
    <div className="c-mesa">
      <header className="c-cabecera">
        <div>
          <strong>Consola de operador</strong>
          <span className="suave"> · {yo.operador.nombre}</span>
        </div>
        <div className="c-cabecera-der">
          <span className={`c-punto ${enLinea ? 'ok' : ''}`} title={enLinea ? 'En línea' : 'Sin conexión en tiempo real'} />
          <span className="suave">{enLinea ? 'En línea' : 'Reconectando…'}</span>
          <SelectorTema />
          <button className="c-enlace" onClick={alSalir}>Salir</button>
        </div>
      </header>
      <div className="c-subcabecera">
        <span>{supervision ? 'Supervisión: todos los CAD' : misCads.map((c) => c.nombre).join(', ')}</span>
        {misCads.some((c) => c.modo === 'webhook') && <span className="c-chip">Los CAD con sistema propio se ven en solo lectura</span>}
        {yo.protocolo.estado === 'provisional' && <span className="c-chip c-chip-aviso">Protocolo {yo.protocolo.version} PROVISIONAL: validar con el C5</span>}
      </div>
      {DEMO && <p className="c-demo c-demo-barra">Demo: el API, el CAD y el GPS de las unidades corren simulados en tu navegador. Nada aquí es una emergencia real. <Link href="/demo/">Abrir la app ciudadana</Link> · <Velocidad /></p>}
      <nav className="c-pestanas" aria-label="Vistas de la consola">
        {([['bandeja', 'Bandeja'], ['unidades', 'Unidades (GPS)'], ['tiempos', 'Tiempos y quejas']] as const).map(([v, t]) => (
          <button key={v} className={vista === v ? 'activa' : ''} aria-pressed={vista === v} onClick={() => setVista(v)}>{t}</button>
        ))}
      </nav>
      {aviso && <p className="c-error c-aviso" role="alert">{aviso} <button className="c-enlace" onClick={() => setAviso('')}>Cerrar</button></p>}

      {vista === 'unidades' && <VistaUnidades unidades={unidades} reportes={lista} nombreCad={nombreCad} />}
      {vista === 'tiempos' && <VistaTiempos token={token} ahora={ahora} nombreCad={nombreCad} alAbrir={(f) => { setSel(f); setVista('bandeja'); setTodos(true); }} />}
      {vista === 'bandeja' && <div className={`c-columnas ${actual ? 'con-detalle' : ''}`}>
        <section className="c-bandeja" aria-label="Bandeja de reportes">
          <div className="c-fila">
            <h2>Bandeja {nuevos > 0 && <span className="c-contador">{nuevos} nuevos</span>}</h2>
            <label className="c-check"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Ver cerrados</label>
          </div>
          {!lista.length && <p className="suave">Sin reportes {todos ? '' : 'activos '}por ahora. Los nuevos aparecen aquí al instante.</p>}
          {lista.map((r) => (
            <button key={r.folio} className={`c-item p-${r.prioridad} ${sel === r.folio ? 'sel' : ''} ${esFinal(r.estado) ? 'final' : ''}`} onClick={() => setSel(r.folio)}>
              <div className="c-fila">
                <strong>{r.incidente}</strong>
                <span className="suave">{hace(r.creadoEn, ahora)}</span>
              </div>
              <div className="c-etiquetas">
                {r.asistenciaDirecta && <span className="c-chip c-chip-alerta">Asistencia directa</span>}
                <span className={`c-chip e-${r.estado}`}>{ESTADO[r.estado]}</span>
                <span className="c-chip">Prioridad {r.prioridad}</span>
                {!r.operable && <span className="c-chip">Solo lectura</span>}
                {r.opinion?.queja && <span className="c-chip c-chip-alerta">Queja</span>}
                {!esFinal(r.estado) && <ChipLlegada t={r.tiempos.llegada} />}
              </div>
              <div className="suave c-pequeno">{r.folio} · {nombreCad(r.cadId)}</div>
              {r.escalaAlC5En && <Cuenta hasta={r.escalaAlC5En} ahora={ahora} />}
            </button>
          ))}
        </section>

        {actual ? (
          <Detalle key={actual.folio} r={actual} ahora={ahora} unidades={unidades} yo={yo} nombreCad={nombreCad} actuar={actuar} alCerrar={() => setSel(null)} />
        ) : (
          <section className="c-detalle c-vacio suave">Elige un reporte de la bandeja para ver el cuestionario de la despachadora virtual y despachar.</section>
        )}
      </div>}
    </div>
  );
}

function Cuenta({ hasta, ahora }: { hasta: string; ahora: number }) {
  const s = Math.round((new Date(hasta).getTime() - ahora) / 1000);
  return <div className="c-cuenta">{s > 0 ? `Sin acuse: se escala al C5 en ${s} s` : 'Escalando al C5…'}</div>;
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

  const delCad = unidades.filter((u) => u.cadId === r.cadId);
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
  const final = esFinal(r.estado);
  const mapa = `https://www.openstreetmap.org/?mlat=${r.ubicacion.lat}&mlon=${r.ubicacion.lng}#map=18/${r.ubicacion.lat}/${r.ubicacion.lng}`;
  const unidadMapa = r.unidad?.lat != null && r.unidad.lng != null
    ? { id: r.unidad.unidadId, etiqueta: r.unidad.etiqueta, lat: r.unidad.lat, lng: r.unidad.lng, rumbo: r.unidad.rumbo }
    : null;
  const otras = final ? [] : delCad.filter((u) => u.posicion && u.unidadId !== r.unidad?.unidadId).map((u) => ({ id: u.unidadId, etiqueta: u.etiqueta, lat: u.posicion!.lat, lng: u.posicion!.lng, ocupada: !!u.ocupadaEn }));

  return (
    <section className="c-detalle" aria-label={`Reporte ${r.folio}`}>
      <div className="c-fila">
        <button className="c-enlace c-volver" onClick={alCerrar}>← Bandeja</button>
        <span className="suave c-pequeno">Actualizado {hora(r.actualizadoEn)}</span>
      </div>
      <div className={`c-tarjeta c-titulo p-${r.prioridad}`}>
        <div className="c-fila">
          <h2>{r.incidente}</h2>
          <span className={`c-chip e-${r.estado}`}>{ESTADO[r.estado]}</span>
        </div>
        <div className="suave">{r.folio}{r.folioCad && r.folioCad !== r.folio ? ` · CAD ${r.folioCad}` : ''} · {nombreCad(r.cadId)} · hace {hace(r.creadoEn, ahora)}</div>
        <div className="c-etiquetas">
          {r.asistenciaDirecta && <span className="c-chip c-chip-alerta">Botón de asistencia directa</span>}
          {r.escenarioId && <span className="c-chip">Acceso rápido de lugar guardado</span>}
          <span className="c-chip">Prioridad {r.prioridad}</span>
          {r.codigoCnie && <span className="c-chip">CNIE {r.codigoCnie}</span>}
        </div>
        {r.escalaAlC5En && <Cuenta hasta={r.escalaAlC5En} ahora={ahora} />}
      </div>

      {r.canalizacion.alertas.length > 0 && (
        <div className="c-alertas">{r.canalizacion.alertas.map((a) => <span key={a} className="c-chip c-chip-alerta">{a}</span>)}</div>
      )}

      <div className="c-rejilla">
        <div className="c-tarjeta">
          <h3>Canalización sugerida</h3>
          <ol className="c-lista">{r.canalizacion.corporaciones.map((c, i) => <li key={c}>{CORPORACION[c] ?? c}{i === 0 ? ' (principal)' : ' (apoyo)'}</li>)}</ol>
        </div>
        <div className="c-tarjeta">
          <h3>Reportante</h3>
          {r.reportante ? (
            <>
              <div>{r.reportante.nombre} {r.reportante.identidad && r.reportante.identidad !== 'completa' && <span className="c-chip">{IDENTIDAD[r.reportante.identidad]}</span>}</div>
              {r.reportante.identidad === 'completa' || !r.reportante.identidad
                ? <a href={`tel:${r.reportante.telefono}`}>{r.reportante.telefono}</a>
                : <div className="suave c-pequeno">{r.reportante.telefono ? `Tel. ${r.reportante.telefono} (oculto)` : 'Sin teléfono'}. Contesta por el chat del folio.</div>}
              <div className="suave c-pequeno">Confiabilidad {Math.round(r.reportante.confiabilidad * 100)}%</div>
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
          {r.unidad && <span className="suave c-pequeno">{r.unidad.etiqueta}{r.unidad.distanciaMetros != null && r.unidad.distanciaMetros > 0 ? ` a ${distanciaTexto(r.unidad.distanciaMetros)}` : ''}{r.unidad.etaMinutos ? ` · llega en ~${r.unidad.etaMinutos} min` : r.estado === 'en_sitio' ? ' · en el lugar' : ''}</span>}
        </div>
        <Mapa reporte={r.ubicacion} unidad={unidadMapa} unidades={otras} alto={240} titulo={`Mapa del reporte ${r.folio}${r.unidad ? ` con ${r.unidad.etiqueta}` : ''}`} />
        {!final && <p className="suave c-pequeno c-leyenda"><span className="c-punto-l asignada" /> asignada <span className="c-punto-l libre" /> libre <span className="c-punto-l ocupada" /> ocupada</p>}
      </div>

      <Tiempos t={r.tiempos} />

      {r.operable && !final && (
        <div className="c-tarjeta c-acciones">
          <h3>Despacho</h3>
          {(r.estado === 'recibido' || r.estado === 'transferido') && (
            <button className="c-boton" disabled={ocupado} onClick={() => hacer({ accion: 'recibir' })}>Recibir reporte</button>
          )}
          {(r.estado === 'recibido' || r.estado === 'transferido') && <p className="suave c-pequeno">Al recibirlo se asigna sola la unidad libre más cercana.</p>}
          {puede('asignado') && (
            <>
              {sugerida && !r.unidad && (
                <button className="c-boton c-grande" disabled={ocupado} onClick={() => hacer({ accion: 'asignar_cercana' })}>
                  Asignar la más cercana: {sugerida.u.etiqueta} · {distanciaTexto(sugerida.ruta!.metros)} · ~{Math.max(1, Math.ceil(sugerida.ruta!.segundos / 60))} min
                </button>
              )}
              <div className="c-form">
                <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} aria-label={r.unidad ? 'Cambiar unidad' : 'Elegir otra unidad'}>
                  <option value="">{r.unidad ? 'Cambiar a otra unidad…' : 'Elegir otra unidad…'}</option>
                  {opciones.map(({ u, ruta }) => (
                    <option key={u.unidadId} value={u.unidadId} disabled={!!u.ocupadaEn}>
                      {u.etiqueta} · {CORPORACION[u.corporacion] ?? u.corporacion}{ruta ? ` · ${distanciaTexto(ruta.metros)} · ~${Math.max(1, Math.ceil(ruta.segundos / 60))} min` : ' · sin GPS'}{u.ocupadaEn ? ` (ocupada en ${u.ocupadaEn})` : ''}
                    </option>
                  ))}
                </select>
                <button className="c-boton" disabled={ocupado || !unidadId} onClick={() => hacer({ accion: 'asignar', unidadId }, () => setUnidadId(''))}>Asignar</button>
              </div>
              <p className="suave c-pequeno">El tiempo de llegada se calcula por ruta desde el GPS de la unidad; no se escribe a mano.</p>
            </>
          )}
          <div className="c-botones">
            {puede('en_camino') && <button className="c-boton-sec" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'en_camino' })}>En camino</button>}
            {puede('en_sitio') && <button className="c-boton-sec" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'en_sitio' })}>Unidad en sitio</button>}
            {puede('cerrado') && <button className="c-boton-sec" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'cerrado', nota: 'Atendido' })}>Cerrar como atendido</button>}
            {puede('improcedente') && <button className="c-boton-sec c-peligro" disabled={ocupado} onClick={() => hacer({ accion: 'estado', estado: 'improcedente' })}>Improcedente</button>}
          </div>
          {puede('transferido') && (
            <div className="c-form">
              <select value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="CAD destino">
                <option value="">Transferir a…</option>
                {yo.cads.filter((c) => c.id !== r.cadId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
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
          <span className={`c-chip ${r.cuestionario.protocoloEstado === 'provisional' ? 'c-chip-aviso' : ''}`}>Protocolo {r.cuestionario.protocoloVersion}</span>
        </div>
        {r.descripcion && <p><strong>Relato:</strong> {r.descripcion}</p>}
        <pre className="c-transcripcion">{r.cuestionario.transcripcion || 'Sin respuestas todavía.'}</pre>
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
          <div><span aria-label={`${r.opinion.calificacion} de 5`}>{'★'.repeat(r.opinion.calificacion)}{'☆'.repeat(5 - r.opinion.calificacion)}</span> · {LLEGO[r.opinion.llegoUnidad]}</div>
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
                <span className="suave c-pequeno">SHA-256 {e.sha256.slice(0, 12)}…{e.expiraEn ? ` · enlace vence ${hora(e.expiraEn)}` : ''}</span>
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
        <ul className="c-lista">{r.historial.map((h, i) => <li key={i}>{hora(h.en)} · {ESTADO[h.estado]}{h.nota ? ` (${h.nota})` : ''}</li>)}</ul>
      </div>
    </section>
  );
}

const ESTADO_ETAPA: Record<TiempoEtapa['estado'], string> = {
  cumplida: 'En meta', excedida: 'Fuera de meta', en_curso: 'En curso', en_riesgo: 'Por vencer', pendiente: 'Pendiente', omitida: '—',
};

/** Tiempo desde el reporte contra la meta de llegada, para la bandeja. */
function ChipLlegada({ t }: { t: Reporte['tiempos']['llegada'] }) {
  if (t.segundos == null) return null;
  const cls = t.estado === 'excedida' ? 'c-chip-alerta' : t.estado === 'en_riesgo' ? 'c-chip-aviso' : t.estado === 'cumplida' ? 'c-chip-ok' : '';
  return <span className={`c-chip ${cls}`} title="Desde el reporte hasta la llegada, contra la meta">{duracionTexto(t.segundos)} / meta {Math.round(t.metaSegundos / 60)} min</span>;
}

function Tiempos({ t }: { t: Reporte['tiempos'] }) {
  return (
    <div className="c-tarjeta">
      <div className="c-fila">
        <h3>Tiempos de respuesta</h3>
        <span className="c-chip c-chip-aviso" title="Metas provisionales: acordar con cada municipio y el C5">Metas {t.metasVersion}</span>
      </div>
      <table className="c-tiempos">
        <thead><tr><th scope="col">Etapa</th><th scope="col">Tiempo</th><th scope="col">Meta</th><th scope="col">Estado</th></tr></thead>
        <tbody>
          {t.etapas.map((e) => (
            <tr key={e.id} className={`t-${e.estado}`}>
              <th scope="row">{e.nombre}</th>
              <td>{e.segundos == null ? '—' : duracionTexto(e.segundos)}</td>
              <td>{duracionTexto(e.metaSegundos)}</td>
              <td><span className={`c-chip t-chip-${e.estado}`}>{ESTADO_ETAPA[e.estado]}</span></td>
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
function VistaUnidades({ unidades, reportes, nombreCad }: { unidades: UnidadDisponible[]; reportes: Reporte[]; nombreCad: (id: string) => string }) {
  const [cad, setCad] = useState('');
  const visibles = unidades.filter((u) => !cad || u.cadId === cad);
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
      <Mapa
        reporte={activos[0]?.ubicacion ?? null}
        etiquetaReporte={activos[0] ? `${activos[0].incidente} (${activos[0].folio})` : undefined}
        unidades={visibles.filter((u) => u.posicion).map((u) => ({ id: u.unidadId, etiqueta: u.etiqueta, lat: u.posicion!.lat, lng: u.posicion!.lng, ocupada: !!u.ocupadaEn }))}
        alto={360}
        titulo="Mapa con la posición GPS de las unidades"
      />
      <table className="c-tiempos c-unidades">
        <thead><tr><th scope="col">Unidad</th><th scope="col">CAD</th><th scope="col">Estado</th><th scope="col">GPS</th></tr></thead>
        <tbody>
          {visibles.map((u) => (
            <tr key={u.unidadId}>
              <th scope="row">{u.etiqueta}<div className="suave c-pequeno">{CORPORACION[u.corporacion] ?? u.corporacion}</div></th>
              <td>{nombreCad(u.cadId)}</td>
              <td>{u.ocupadaEn ? <span className="c-chip">Atiende {u.ocupadaEn}</span> : <span className="c-chip c-chip-ok">Libre</span>}</td>
              <td className="c-pequeno">{u.posicion ? `${u.posicion.lat.toFixed(4)}, ${u.posicion.lng.toFixed(4)}` : 'Sin señal'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Tablero: tiempo por etapa contra su meta, cumplimiento, calificaciones y quejas. */
function VistaTiempos({ token, ahora, nombreCad, alAbrir }: { token: string; ahora: number; nombreCad: (id: string) => string; alAbrir: (folio: string) => void }) {
  const [t, setT] = useState<Tablero | null>(null);
  const [error, setError] = useState('');
  const cada5 = Math.floor(ahora / 5000);
  useEffect(() => { api.tiempos(token).then(setT).catch((e) => setError(mensajeDe(e))); }, [token, cada5]);
  if (error) return <p className="c-error c-panel" role="alert">{error}</p>;
  if (!t) return <p className="suave c-panel">Cargando…</p>;
  const quejas = t.reportes.filter((r) => r.opinion?.queja);
  return (
    <section className="c-panel" aria-label="Tablero de tiempos de respuesta">
      <div className="c-fila">
        <h2>Tiempos de respuesta</h2>
        <span className="c-chip c-chip-aviso">Metas {t.metas.version} (provisionales)</span>
      </div>
      <div className="c-kpis">
        <div className="c-kpi"><strong>{t.reportes.length}</strong><span>reportes</span></div>
        <div className="c-kpi"><strong>{t.resumen.find((x) => x.id === 'llegada')?.enMeta ?? '—'}{t.resumen.find((x) => x.id === 'llegada')?.enMeta != null ? '%' : ''}</strong><span>llegadas en meta</span></div>
        <div className="c-kpi"><strong>{t.calificacionPromedio ?? '—'}</strong><span>calificación (1 a 5)</span></div>
        <div className={`c-kpi ${t.quejas ? 'alerta' : ''}`}><strong>{t.quejas}</strong><span>quejas</span></div>
      </div>
      <div className="c-tarjeta">
        <table className="c-tiempos">
          <thead><tr><th scope="col">Etapa</th><th scope="col">Promedio</th><th scope="col">Mediana</th><th scope="col">Meta (alta / media / baja)</th><th scope="col">En meta</th></tr></thead>
          <tbody>
            {t.resumen.map((x) => {
              const metas = x.id === 'llegada' ? t.metas.llegada : t.metas.etapas[x.id];
              return (
                <tr key={x.id}>
                  <th scope="row">{x.nombre}<div className="suave c-pequeno">{x.n} medidos</div></th>
                  <td>{x.promedioSegundos == null ? '—' : duracionTexto(x.promedioSegundos)}</td>
                  <td>{x.medianaSegundos == null ? '—' : duracionTexto(x.medianaSegundos)}</td>
                  <td className="c-pequeno">{duracionTexto(metas.alta)} / {duracionTexto(metas.media)} / {duracionTexto(metas.baja)}</td>
                  <td>{x.enMeta == null ? '—' : <span className={`c-chip ${x.enMeta >= 90 ? 'c-chip-ok' : x.enMeta >= 70 ? 'c-chip-aviso' : 'c-chip-alerta'}`}>{x.enMeta}%</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="c-tarjeta">
        <h3>Quejas y calificaciones</h3>
        {!t.reportes.some((r) => r.opinion) && <p className="suave">Aún no hay calificaciones. El ciudadano califica cuando su reporte termina.</p>}
        <ul className="c-lista-plana">
          {[...quejas, ...t.reportes.filter((r) => r.opinion && !r.opinion.queja)].map((r) => (
            <li key={r.folio}>
              <button className="c-enlace" onClick={() => alAbrir(r.folio)}>{r.folio}</button> · {nombreCad(r.cadId)} · {'★'.repeat(r.opinion!.calificacion)}{'☆'.repeat(5 - r.opinion!.calificacion)} · {LLEGO[r.opinion!.llegoUnidad]}
              {r.opinion!.queja && <span className="c-chip c-chip-alerta">Queja</span>}
              {r.opinion!.comentario && <div className="suave c-pequeno">“{r.opinion!.comentario}”</div>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Velocidad del reloj de la demo (×1 tiempo real, ×10 acelerado). */
function Velocidad() {
  const [v, setV] = useState(1);
  useEffect(() => { setV(demo.velocidad()); return demo.escuchar(() => setV(demo.velocidad())); }, []);
  return (
    <label className="c-velocidad">Tiempo:{' '}
      <select value={v} onChange={(e) => demo.fijarVelocidad(Number(e.target.value))} aria-label="Velocidad de la demo">
        <option value={1}>real (×1)</option>
        <option value={10}>acelerado (×10)</option>
      </select>
    </label>
  );
}
