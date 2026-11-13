'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import './consola.css';
import {
  API, CORPORACION, ERRORES, ESTADO, ErrorApi, api, esFinal, hace, hora, ordenar,
  type Accion, type Reporte, type UnidadDisponible, type Yo,
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
  const [ahora, setAhora] = useState(() => Date.now());
  const socket = useRef<Socket | null>(null);
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
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Tiempo real: cada cambio llega con la vista completa del reporte.
  useEffect(() => {
    const s = io(`${API}/operacion`, { transports: ['websocket'] });
    socket.current = s;
    const suscribir = () => s.emit('suscribir', { token }, (r: { ok: boolean }) => { setEnLinea(r.ok); if (!r.ok) alSalir(); });
    s.on('connect', suscribir);
    s.on('disconnect', () => setEnLinea(false));
    s.on('reporte.actualizado', (v: Reporte) => {
      setReportes((m) => {
        const n = new Map(m);
        const mio = supervision || yo.operador.cads.includes(v.cadId);
        if (!mio) n.delete(v.folio);
        else if (!esMasViejo(v, m.get(v.folio))) n.set(v.folio, v);
        return n;
      });
      void api.unidades(token).then((u) => setUnidades(u.unidades)).catch(() => {});
    });
    return () => { s.close(); socket.current = null; };
  }, [token, supervision, yo.operador.cads, alSalir]);

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
          <button className="c-enlace" onClick={alSalir}>Salir</button>
        </div>
      </header>
      <div className="c-subcabecera">
        <span>{supervision ? 'Supervisión: todos los CAD' : misCads.map((c) => c.nombre).join(', ')}</span>
        {misCads.some((c) => c.modo === 'webhook') && <span className="c-chip">Los CAD con sistema propio se ven en solo lectura</span>}
        {yo.protocolo.estado === 'provisional' && <span className="c-chip c-chip-aviso">Protocolo {yo.protocolo.version} PROVISIONAL: validar con el C5</span>}
      </div>
      {aviso && <p className="c-error c-aviso" role="alert">{aviso} <button className="c-enlace" onClick={() => setAviso('')}>Cerrar</button></p>}

      <div className={`c-columnas ${actual ? 'con-detalle' : ''}`}>
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
      </div>
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
  const [eta, setEta] = useState('');
  const [texto, setTexto] = useState('');
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');

  const delCad = unidades.filter((u) => u.cadId === r.cadId);
  const principal = r.canalizacion.corporaciones[0];
  // Primero las libres de la corporación principal, luego el resto.
  const opciones = [...delCad].sort((a, b) => Number(!!a.ocupadaEn) - Number(!!b.ocupadaEn) || Number(b.corporacion === principal) - Number(a.corporacion === principal));

  async function hacer(a: Accion, despues?: () => void) {
    setOcupado(true);
    if (await actuar(a)) despues?.();
    setOcupado(false);
  }

  const puede = (e: Reporte['estado']) => r.transiciones.includes(e);
  const final = esFinal(r.estado);
  const mapa = `https://www.openstreetmap.org/?mlat=${r.ubicacion.lat}&mlon=${r.ubicacion.lng}#map=18/${r.ubicacion.lat}/${r.ubicacion.lng}`;

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
              <div>{r.reportante.nombre}</div>
              <a href={`tel:${r.reportante.telefono}`}>{r.reportante.telefono}</a>
              <div className="suave c-pequeno">Confiabilidad {Math.round(r.reportante.confiabilidad * 100)}%</div>
            </>
          ) : <div className="suave">No disponible</div>}
        </div>
        <div className="c-tarjeta">
          <h3>Ubicación</h3>
          {r.ubicacion.referencia && <div>{r.ubicacion.referencia}</div>}
          <div className="suave c-pequeno">{r.ubicacion.lat.toFixed(5)}, {r.ubicacion.lng.toFixed(5)}{r.ubicacion.precisionMetros ? ` · ±${Math.round(r.ubicacion.precisionMetros)} m` : ''}</div>
          <a href={mapa} target="_blank" rel="noreferrer">Abrir mapa</a>
        </div>
      </div>

      {r.operable && !final && (
        <div className="c-tarjeta c-acciones">
          <h3>Despacho</h3>
          {(r.estado === 'recibido' || r.estado === 'transferido') && (
            <button className="c-boton" disabled={ocupado} onClick={() => hacer({ accion: 'recibir' })}>Recibir reporte</button>
          )}
          {puede('asignado') && (
            <div className="c-form">
              <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} aria-label="Unidad">
                <option value="">Elige unidad…</option>
                {opciones.map((u) => (
                  <option key={u.unidadId} value={u.unidadId} disabled={!!u.ocupadaEn}>
                    {u.etiqueta} · {CORPORACION[u.corporacion] ?? u.corporacion}{u.ocupadaEn ? ` (ocupada en ${u.ocupadaEn})` : ''}
                  </option>
                ))}
              </select>
              <input type="number" min={0} max={240} placeholder="ETA min" value={eta} onChange={(e) => setEta(e.target.value)} aria-label="Minutos estimados de llegada" />
              <button className="c-boton" disabled={ocupado || !unidadId} onClick={() => hacer({ accion: 'asignar', unidadId, ...(eta && { etaMinutos: Number(eta) }) }, () => setUnidadId(''))}>Asignar</button>
            </div>
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

      {r.unidad && (
        <div className="c-tarjeta">
          <h3>Unidad</h3>
          <div>{r.unidad.etiqueta} · {CORPORACION[r.unidad.corporacion] ?? r.unidad.corporacion}{r.unidad.etaMinutos != null ? ` · llega en ~${r.unidad.etaMinutos} min` : ''}</div>
        </div>
      )}

      {r.evidencias.length > 0 && (
        <div className="c-tarjeta">
          <h3>Evidencia</h3>
          <ul className="c-lista">{r.evidencias.map((e) => <li key={e.id}><a href={e.url} target="_blank" rel="noreferrer">{e.tipo}</a> <span className="suave c-pequeno">SHA-256 {e.sha256.slice(0, 12)}… · enlace vence {hora(e.expiraEn)}</span></li>)}</ul>
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
