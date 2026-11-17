'use client';

/**
 * Vistas de la consola para la interconexión con los 18 municipios:
 * alta de municipios (Modo A con CAD / Modo B con la consola), registro de unidades,
 * reportes por municipio y periodo (CSV y PDF) y el reporte mensual al SESNSP.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { imprimirReporte } from './imprimir';
import { TablaFolios } from './folios';
import { ACTOR_ESTADO, CAD_ESTATAL_ID, CORPORACIONES, MUNICIPIOS_QRO, NOMBRE_RESPALDO_ESTATAL, NOMBRE_RESPALDO_ESTATAL_LARGO, TIPOS_UNIDAD, duracionTexto, type Grupo, type TipoUnidad, type UmbralesSemaforo } from '@pol-iaq/shared/movil';
import { CORPORACION, DEMO, ErrorApi, ERRORES, api, guardarArchivo, type EstadisticaVista, type FiltroReportes, type ListaSesnsp, type MesSesnsp, type UnidadDisponible, type VistaCad, type Yo } from './consola';

const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? ERRORES[e.codigo] ?? e.mensaje ?? `Error (${e.codigo})` : 'Sin conexión con el API.');
const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const TIPO: Record<string, string> = Object.fromEntries(TIPOS_UNIDAD.map((t) => [t.id, t.nombre]));
const ESTADO_CAD: Record<string, string> = { pruebas: 'En pruebas', activo: 'Activo', suspendido: 'Suspendido' };
const MODO: Record<string, string> = { webhook: 'Modo A · CAD propio', consola: 'Modo B · consola POL-IAQ' };
const pct = (x: number | null) => (x == null ? '—' : `${x}%`);
const chipMeta = (x: number | null) => (x == null ? '—' : <span className={`c-chip ${x >= 90 ? 'c-chip-ok' : x >= 70 ? 'c-chip-aviso' : 'c-chip-alerta'}`}>{pct(x)}</span>);

function Error({ texto, alReintentar }: { texto: string; alReintentar: () => void }) {
  return (
    <div className="estado estado-error" role="alert">
      <h3>No se pudo cargar</h3>
      <p>{texto}</p>
      <button className="c-boton" onClick={alReintentar}>Reintentar</button>
    </div>
  );
}

const Cargando = ({ texto }: { texto: string }) => (
  <div aria-busy="true"><div className="esqueleto c-esq-tabla" /><span className="solo-lector">{texto}</span></div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Municipios (alta y estado de cada CAD)
// ─────────────────────────────────────────────────────────────────────────────

export function VistaMunicipios({ token, alCambio }: { token: string; alCambio: () => void }) {
  const [cads, setCads] = useState<VistaCad[] | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ok, setOk] = useState('');
  const [alta, setAlta] = useState<string | null>(null);
  const cargar = useCallback(() => { setError(''); api.cads(token).then((r) => setCads(r.cads)).catch((e) => setError(mensajeDe(e))); }, [token]);
  useEffect(cargar, [cargar]);

  async function estado(cadId: string, e: 'activo' | 'suspendido' | 'pruebas') {
    setAviso(''); setOk('');
    try {
      const v = await api.estadoCad(token, cadId, e);
      setCads((l) => l?.map((x) => (x.cadId === cadId ? v : x)) ?? null);
      setOk(`${v.nombre}: ${ESTADO_CAD[v.estado ?? ''] ?? v.estado}.`);
      alCambio();
    } catch (err) { setAviso(mensajeDe(err)); }
  }

  async function disponibilidad(c: VistaCad, sinOperador: boolean) {
    setAviso(''); setOk('');
    try {
      await api.disponibilidad(token, c.cadId, sinOperador);
      setOk(sinOperador ? `${c.nombre}: sin operador disponible. Sus reportes nuevos van al ${NOMBRE_RESPALDO_ESTATAL}.` : `${c.nombre}: con operador disponible.`);
      cargar();
      alCambio();
    } catch (err) { setAviso(mensajeDe(err)); }
  }

  if (error) return <section className="c-panel"><Error texto={error} alReintentar={cargar} /></section>;
  if (!cads) return <section className="c-panel"><Cargando texto="Cargando municipios…" /></section>;
  const municipios = cads.filter((c) => c.cadId !== CAD_ESTATAL_ID);
  const conectados = municipios.filter((c) => c.conectado).length;
  return (
    <section className="c-panel" aria-label="Municipios y CAD">
      <div className="c-fila">
        <h2>Municipios de Querétaro</h2>
        <span className="c-chip">{`${conectados} de 18 conectados`}</span>
      </div>
      <div className="c-tarjeta c-respaldo-estatal" data-testid="respaldo-estatal">
        <strong>{`Respaldo estatal: ${NOMBRE_RESPALDO_ESTATAL}`}</strong>
        <p className="c-pequeno">{`${NOMBRE_RESPALDO_ESTATAL_LARGO}. Opera el 911 y el 089 en todo el estado. Los reportes de municipios sin CAD los atiende el ${NOMBRE_RESPALDO_ESTATAL}, igual que los de un municipio sin capacidad (sin unidades en servicio o sin operador), los anónimos (089) y los que un CAD no acusa a tiempo. El folio conserva la clave INEGI del municipio.`}</p>
      </div>
      <p className="suave c-pequeno">{'Modo A: el municipio conecta su CAD por API (adaptador de referencia). Modo B: despacha desde esta consola. Abajo, los 18 municipios y el Estado (actor 19).'}</p>
      {aviso && <div className="c-aviso" role="alert"><span>{aviso}</span><button className="c-enlace" onClick={() => setAviso('')}>Cerrar</button></div>}
      {ok && <div className="c-nota" role="status">{ok}</div>}
      {alta && <FormAlta token={token} cad={cads.find((c) => c.cadId === alta)!} alCancelar={() => setAlta(null)} alGuardar={(v) => { setCads((l) => l?.map((x) => (x.cadId === v.cadId ? v : x)) ?? null); setAlta(null); setOk(`Alta guardada: ${v.nombre} (${ESTADO_CAD[v.estado ?? ''] ?? ''}).`); alCambio(); }} />}
      <div className="c-tabla-desliza">
        <table className="c-tiempos c-municipios" data-testid="tabla-municipios">
          <thead><tr><th scope="col">Clave INEGI</th><th scope="col">Actor</th><th scope="col">Modo</th><th scope="col">Estado</th><th scope="col">Unidades</th><th scope="col">Pruebas</th><th scope="col"><span className="solo-lector">Acciones</span></th></tr></thead>
          <tbody>
            {municipios.map((c) => (
              <tr key={c.cadId} data-cad={c.cadId}>
                <td className="c-mono">{c.clave ?? '—'}</td>
                <th scope="row">{c.nombre}{c.piloto && <span className="c-chip c-chip-neutro">Piloto</span>}</th>
                <td className="c-pequeno">
                  {c.modo ? MODO[c.modo] : <span className="suave">{`Sin conectar · va al ${NOMBRE_RESPALDO_ESTATAL}`}</span>}
                  {c.sinCapacidad && <div className="c-respaldo" data-testid="sin-capacidad">{`Sin capacidad (${c.sinCapacidad}) · va al ${NOMBRE_RESPALDO_ESTATAL}`}</div>}
                </td>
                <td>{c.estado ? <span className={`c-chip ${c.estado === 'activo' ? 'c-chip-ok' : c.estado === 'pruebas' ? 'c-chip-aviso' : 'c-chip-alerta'}`}>{ESTADO_CAD[c.estado]}</span> : '—'}</td>
                <td>{c.unidades}</td>
                <td className="c-pequeno">{c.modo === 'webhook' ? `${8 - c.casosPendientes.length} de 8` : c.modo === 'consola' ? 'No aplica' : '—'}</td>
                <td className="c-acciones-fila">
                  {c.clave && !c.piloto && <button className="c-boton-sec" onClick={() => setAlta(c.cadId)}>{c.registrado ? 'Editar alta' : 'Dar de alta'}</button>}
                  {c.registrado && c.estado === 'pruebas' && <button className="c-boton" onClick={() => void estado(c.cadId, 'activo')}>Activar</button>}
                  {c.registrado && c.estado === 'activo' && !c.piloto && <button className="c-boton-sec c-peligro" onClick={() => void estado(c.cadId, 'suspendido')}>Suspender</button>}
                  {c.registrado && c.estado === 'suspendido' && <button className="c-boton-sec" onClick={() => void estado(c.cadId, 'activo')}>Reactivar</button>}
                  {c.conectado && (c.sinOperador
                    ? <button className="c-boton-sec" onClick={() => void disponibilidad(c, false)}>Operador disponible</button>
                    : <button className="c-boton-sec" onClick={() => void disponibilidad(c, true)}>Sin operador</button>)}
                </td>
              </tr>
            ))}
            <tr data-cad={ACTOR_ESTADO.id} data-testid="actor-estado">
              <td className="suave c-pequeno">Pendiente</td>
              <th scope="row">{ACTOR_ESTADO.nombre}<span className="c-chip c-chip-neutro">Actor 19</span><div className="c-pequeno" data-testid="ambito-estado">{`Ámbito: ${ACTOR_ESTADO.ambito}`}</div></th>
              <td className="c-pequeno suave" colSpan={4}>{ACTOR_ESTADO.pendiente}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <details className="c-tarjeta">
        <summary>Casos de prueba obligatorios antes de producción (Modo A)</summary>
        <ol className="c-pequeno">
          {cads[0]?.casosPrueba.map((x) => <li key={x.id}>{x.nombre}</li>)}
        </ol>
        <p className="suave c-pequeno">{DEMO ? 'En la demo no hay ambiente de pruebas: los 8 casos se corren con la suite de certificación (services/cad-adaptador) contra el API real.' : 'Se corren con la suite de certificación (pnpm --filter @pol-iaq/cad-adaptador certificar) contra el ambiente de pruebas; los resultados quedan en el alta.'}</p>
      </details>
    </section>
  );
}

function FormAlta({ token, cad, alCancelar, alGuardar }: { token: string; cad: VistaCad; alCancelar: () => void; alGuardar: (v: VistaCad) => void }) {
  const [modo, setModo] = useState<'consola' | 'webhook'>(cad.modo ?? 'consola');
  const [webhookUrl, setWebhookUrl] = useState(cad.webhookUrl ?? '');
  const [secreto, setSecreto] = useState('');
  const [huella, setHuella] = useState(cad.certificadoSha256 ?? '');
  const [ips, setIps] = useState(cad.ipsPermitidas.join(', '));
  const [contacto, setContacto] = useState(cad.contactoTecnico?.nombre ?? '');
  const [correo, setCorreo] = useState(cad.contactoTecnico?.correo ?? '');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setOcupado(true);
    try {
      alGuardar(await api.guardarCad(token, {
        cadId: cad.cadId, nombre: cad.nombre, clave: cad.clave, modo,
        ...(modo === 'webhook' && { webhookUrl: webhookUrl.trim(), ...(secreto && { secreto }), ...(huella.trim() && { certificadoSha256: huella.trim() }) }),
        ipsPermitidas: ips.split(',').map((x) => x.trim()).filter(Boolean),
        contactoTecnico: { nombre: contacto.trim(), correo: correo.trim() },
      }));
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(false); }
  }

  return (
    <form className="c-tarjeta c-alta" onSubmit={guardar} aria-label={`Alta de ${cad.nombre}`}>
      <div className="c-fila"><h3>{`Alta de ${cad.nombre}`}</h3><span className="c-chip c-mono">{cad.clave}</span></div>
      <fieldset className="c-opciones">
        <legend>¿Cómo se conecta?</legend>
        <label className="c-check"><input type="radio" name="modo" checked={modo === 'consola'} onChange={() => setModo('consola')} /> Modo B · despacha desde la consola de POL-IAQ (sin CAD)</label>
        <label className="c-check"><input type="radio" name="modo" checked={modo === 'webhook'} onChange={() => setModo('webhook')} /> Modo A · conecta su CAD por API (webhook firmado)</label>
      </fieldset>
      {modo === 'webhook' && <>
        <label className="c-campo">URL del webhook (adaptador del CAD)<input type="url" required value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://adaptador.municipio.example/poliaq/eventos" /></label>
        <label className="c-campo">{cad.tieneSecreto ? 'Secreto HMAC (déjalo vacío para conservar el actual)' : 'Secreto HMAC compartido (32 caracteres o más)'}<input type="password" autoComplete="new-password" minLength={32} value={secreto} onChange={(e) => setSecreto(e.target.value)} /></label>
        <label className="c-campo">Huella SHA-256 del certificado de cliente (mTLS)<input value={huella} onChange={(e) => setHuella(e.target.value)} placeholder="AB:CD:… (64 caracteres hex)" /></label>
      </>}
      <label className="c-campo">IPs permitidas (separadas por coma; vacío = cualquiera)<input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="10.20.0.0/16, 201.0.0.10" /></label>
      <label className="c-campo">Contacto técnico<input required minLength={3} value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Nombre de quien opera el CAD" /></label>
      <label className="c-campo">Correo del contacto técnico<input type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} /></label>
      <p className="suave c-pequeno">{'El polígono de jurisdicción es el del Marco Geoestadístico de INEGI 2022; se puede reemplazar por el validado con el municipio.'}</p>
      {error && <p className="c-error" role="alert">{error}</p>}
      <div className="c-botones">
        <button className="c-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar alta'}</button>
        <button type="button" className="c-boton-sec" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de unidades
// ─────────────────────────────────────────────────────────────────────────────

const CORP_DE_TIPO: Record<TipoUnidad, string> = { patrulla: 'policia_municipal', motopatrulla: 'policia_municipal', ambulancia: 'cruz_roja', bomberos: 'bomberos' };

export function FormUnidad({ token, yo, unidades, alGuardar }: { token: string; yo: Yo; unidades: UnidadDisponible[]; alGuardar: () => void }) {
  const propios = yo.cads.filter((c) => c.mio && c.conectado && c.modo === 'consola');
  const [cadId, setCadId] = useState(propios[0]?.id ?? '');
  const [tipo, setTipo] = useState<TipoUnidad>('patrulla');
  const [corporacion, setCorporacion] = useState('policia_municipal');
  const [unidadId, setUnidadId] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // Abierto de entrada solo si aún no hay unidades registradas; después lo controla quien opera.
  const [abierto] = useState(() => !unidades.some((u) => u.origen === 'registro') && propios.some((c) => !c.piloto && c.id !== 'c5-queretaro'));
  const idValido = propios.some((c) => c.id === cadId) ? cadId : propios[0]?.id ?? '';
  if (!propios.length) return null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setOk(''); setOcupado(true);
    try {
      await api.guardarUnidad(token, { unidadId: unidadId.trim(), cadId: idValido, tipo, corporacion, etiqueta: etiqueta.trim(), activa: true });
      setOk(`Unidad ${unidadId.trim().toUpperCase()} registrada en ${yo.cads.find((c) => c.id === idValido)?.nombre}.`);
      setUnidadId(''); setEtiqueta('');
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(false); }
  }
  async function baja(u: UnidadDisponible, activa: boolean) {
    setError(''); setOk('');
    try {
      await api.guardarUnidad(token, { unidadId: u.unidadId, cadId: u.cadId, tipo: u.tipo, corporacion: u.corporacion, etiqueta: u.etiqueta, activa });
      setOk(`${u.etiqueta}: ${activa ? 'de nuevo en servicio' : 'fuera de servicio'}.`);
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  const registradas = unidades.filter((u) => u.origen === 'registro');

  return (
    <details className="c-tarjeta" open={abierto || undefined}>
      <summary>Registrar unidad (patrulla, motopatrulla, ambulancia o bomberos)</summary>
      <form className="c-form c-form-unidad" onSubmit={guardar} aria-label="Registrar unidad">
        <label className="c-campo">CAD<select value={idValido} onChange={(e) => setCadId(e.target.value)}>{propios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="c-campo">Tipo<select value={tipo} onChange={(e) => { const t = e.target.value as TipoUnidad; setTipo(t); setCorporacion(CORP_DE_TIPO[t]); }}>{TIPOS_UNIDAD.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
        <label className="c-campo">Corporación<select value={corporacion} onChange={(e) => setCorporacion(e.target.value)}>{CORPORACIONES.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="c-campo">Clave<input required pattern="[A-Za-z0-9\-]{1,30}" value={unidadId} onChange={(e) => setUnidadId(e.target.value)} placeholder="SJR-P01" /></label>
        <label className="c-campo">Nombre en pantalla<input required minLength={2} maxLength={60} value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Patrulla 01" /></label>
        <button className="c-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar'}</button>
      </form>
      {error && <p className="c-error" role="alert">{error}</p>}
      {ok && <p className="c-nota" role="status">{ok}</p>}
      {registradas.length > 0 && (
        <ul className="c-lista-plana">
          {registradas.map((u) => (
            <li key={u.unidadId} className="c-linea">
              <span>{`${u.etiqueta} · ${TIPO[u.tipo]} · ${u.unidadId}`}</span>
              {u.activa
                ? <button className="c-enlace" onClick={() => void baja(u, false)} disabled={!!u.ocupadaEn}>Fuera de servicio</button>
                : <button className="c-enlace" onClick={() => void baja(u, true)}>Volver a servicio</button>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export const tipoDeUnidad = (t: string) => TIPO[t] ?? t;

// ─────────────────────────────────────────────────────────────────────────────
// Reportes por municipio y periodo
// ─────────────────────────────────────────────────────────────────────────────

function TablaGrupos({ titulo, grupos, clave = true, testId, deOtroCad = false }: { titulo: string; grupos: Grupo[]; clave?: boolean; testId?: string; deOtroCad?: boolean }) {
  if (!grupos.length) return null;
  return (
    <div className="c-tabla-desliza">
      <table className="c-tiempos" aria-label={titulo} data-testid={testId}>
        <thead><tr><th scope="col">{titulo}</th><th scope="col">Reportes</th><th scope="col">Procedentes</th><th scope="col" title="Improcedentes, cancelados o recatalogados a Mal Uso del servicio (tipo 7)">Improcedentes</th>{deOtroCad && <th scope="col" title="Folios que se crearon para otro CAD y llegaron aquí por escalamiento (sin acuse a tiempo) o transferencia">Llegaron de otro CAD</th>}<th scope="col">Quejas</th><th scope="col">Llegada (mediana)</th><th scope="col">En meta</th></tr></thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.clave}>
              <th scope="row">{clave && g.clave !== 'sin' && g.clave !== '000' ? <><span className="c-mono">{g.clave}</span>{` ${g.nombre}`}</> : g.nombre}</th>
              <td>{g.reportes}</td>
              <td>{g.procedentes}</td>
              <td>{g.improcedentes}</td>
              {deOtroCad && <td>{g.deOtroCad ?? 0}</td>}
              <td>{g.quejas ? <span className="c-chip c-chip-alerta">{g.quejas}</span> : 0}</td>
              <td>{g.llegada.medianaSegundos == null ? '—' : duracionTexto(g.llegada.medianaSegundos)}</td>
              <td>{chipMeta(g.llegada.enMeta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VistaReportes({ token, yo, ahora, umbrales }: { token: string; yo: Yo; ahora: number; umbrales?: UmbralesSemaforo }) {
  const [municipio, setMunicipio] = useState('');
  const [cadId, setCadId] = useState('');
  const [periodo, setPeriodo] = useState<'diario' | 'semanal' | 'mensual'>('mensual');
  const [fecha, setFecha] = useState(hoyLocal);
  const [e, setE] = useState<EstadisticaVista | null>(null);
  const [error, setError] = useState('');
  const filtro: FiltroReportes = useMemo(() => ({ ...(municipio && { municipio }), ...(cadId && { cadId }), periodo, fecha }), [municipio, cadId, periodo, fecha]);
  const cada5 = Math.floor(ahora / 5000);
  const cargar = useCallback(() => { setError(''); api.estadistica(token, filtro).then(setE).catch((x) => setError(mensajeDe(x))); }, [token, filtro]);
  useEffect(cargar, [cargar, cada5]);
  const mun = MUNICIPIOS_QRO.find((m) => m.clave === municipio);
  const titulo = `Reporte ${mun ? `de ${mun.nombre} (${mun.clave})` : 'de todos los municipios'}${cadId ? ` · ${yo.cads.find((c) => c.id === cadId)?.nombre}` : ''}`;

  async function csv() {
    try { guardarArchivo(await api.foliosCsv(token, filtro)); } catch (x) { setError(mensajeDe(x)); }
  }
  const seccion = useRef<HTMLElement>(null);
  const [enlaceImpresion, setEnlaceImpresion] = useState('');
  function imprimir() {
    if (seccion.current) setEnlaceImpresion(imprimirReporte(seccion.current, `POL-IAQ · ${titulo}`));
  }

  return (
    <section className="c-panel c-imprimible" aria-label="Reportes por municipio" ref={seccion}>
      <div className="c-fila c-no-imprimir">
        <h2>Reportes por municipio</h2>
        <div className="c-botones">
          <button className="c-boton-sec" onClick={() => void csv()} disabled={!e}>Exportar CSV</button>
          <button className="c-boton-sec" onClick={imprimir} disabled={!e}>Imprimir o guardar PDF</button>
        </div>
      </div>
      {enlaceImpresion && <p className="suave c-pequeno c-no-imprimir" role="status" data-testid="aviso-impresion">{'El reporte se abrió en otra pestaña con el diálogo de impresión; la consola sigue funcionando. '}<a href={enlaceImpresion} target="_blank" rel="noopener noreferrer">Abrir de nuevo la versión para imprimir</a></p>}
      <div className="c-form c-filtros c-no-imprimir" role="group" aria-label="Filtros">
        <label className="c-campo">Municipio<select value={municipio} onChange={(x) => setMunicipio(x.target.value)}><option value="">Todos</option>{MUNICIPIOS_QRO.map((m) => <option key={m.clave} value={m.clave}>{`${m.clave} · ${m.nombre}`}</option>)}</select></label>
        <label className="c-campo">Responsable actual<select value={cadId} onChange={(x) => setCadId(x.target.value)}><option value="">Todos</option>{yo.cads.filter((c) => c.mio).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="c-campo">Periodo<select value={periodo} onChange={(x) => setPeriodo(x.target.value as typeof periodo)}><option value="diario">Diario</option><option value="semanal">Semanal (lunes a domingo)</option><option value="mensual">Mensual</option></select></label>
        <label className="c-campo">Fecha<input type="date" value={fecha} onChange={(x) => setFecha(x.target.value || hoyLocal())} /></label>
      </div>
      <h3 className="c-solo-imprimir">{`POL-IAQ · ${titulo}`}</h3>
      {error && <Error texto={error} alReintentar={cargar} />}
      {!e && !error && <Cargando texto="Cargando reporte…" />}
      {e && <>
        <p className="suave c-pequeno" data-testid="periodo-reporte">{`${titulo} · ${periodo === 'mensual' ? 'mes' : periodo === 'semanal' ? 'semana' : 'día'} ${e.periodo.etiqueta} · hora de Querétaro · sin datos personales`}</p>
        <div className="c-kpis">
          <div className="c-kpi"><strong>{e.reportes}</strong><span>reportes</span></div>
          <div className="c-kpi"><strong data-testid="kpi-procedentes">{e.procedentes}</strong><span>procedentes</span></div>
          <div className="c-kpi"><strong data-testid="kpi-improcedentes">{e.improcedentes}</strong><span title="Improcedentes, cancelados o recatalogados a Mal Uso del servicio">improcedentes</span></div>
          <div className="c-kpi"><strong>{pct(e.etapas.find((x) => x.id === 'llegada')?.enMeta ?? null)}</strong><span>llegadas en meta</span></div>
          <div className="c-kpi"><strong>{e.calificacionPromedio ?? '—'}</strong><span>calificación (1 a 5)</span></div>
          <div className={`c-kpi ${e.quejas ? 'alerta' : ''}`}><strong>{e.quejas}</strong><span>quejas</span></div>
        </div>
        {!e.reportes && (
          <div className="estado c-tarjeta">
            <span className="estado-icono" aria-hidden="true">○</span>
            <h3>Sin reportes en este periodo</h3>
            <p>{DEMO ? 'Levanta reportes desde la app ciudadana de la demo y aparecen aquí.' : 'Cambia el periodo o el municipio.'}</p>
          </div>
        )}
        {e.reportes > 0 && <>
          <div className="c-tarjeta">
            <h3>Tiempos por etapa</h3>
            <div className="c-tabla-desliza">
              <table className="c-tiempos">
                <thead><tr><th scope="col">Etapa</th><th scope="col">Medidos</th><th scope="col">Mediana</th><th scope="col">Promedio</th><th scope="col">En meta</th></tr></thead>
                <tbody>{e.etapas.map((x) => <tr key={x.id}><th scope="row">{x.nombre}</th><td>{x.n}</td><td>{x.medianaSegundos == null ? '—' : duracionTexto(x.medianaSegundos)}</td><td>{x.promedioSegundos == null ? '—' : duracionTexto(x.promedioSegundos)}</td><td>{chipMeta(x.enMeta)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <TablaFolios token={token} filtro={filtro} ahora={ahora} titulo={titulo} umbrales={umbrales} />
          <div className="c-tarjeta"><h3>Por municipio (clave INEGI)</h3><TablaGrupos titulo="Municipio" grupos={e.porMunicipio} testId="por-municipio" /></div>
          <div className="c-tarjeta">
            <h3>Por responsable actual (tras escalamiento)</h3>
            <p className="suave c-pequeno" data-testid="criterio-responsable">{`Cada folio cuenta en el CAD que lo tiene hoy. Si un CAD municipal no acusa a tiempo o lo transfiere, el folio pasa al ${NOMBRE_RESPALDO_ESTATAL} (u otro CAD) y aquí cuenta para ese CAD. El CSV trae las dos columnas: cad_origen (a quién se mandó al crearlo) y cad_responsable_actual.`}</p>
            <TablaGrupos titulo="Responsable actual" grupos={e.porCad} clave={false} testId="por-responsable" deOtroCad />
            <h3>Por CAD de origen (al crear el folio)</h3>
            <TablaGrupos titulo="CAD de origen" grupos={e.porCadOrigen} clave={false} testId="por-cad-origen" />
          </div>
          <div className="c-tarjeta"><h3>Por clasificación CNIE</h3>
            <TablaGrupos titulo="Tipo" grupos={e.porTipo} />
            <TablaGrupos titulo="Subtipo" grupos={e.porSubtipo} />
            <TablaGrupos titulo="Incidente" grupos={e.porIncidente} />
          </div>
          <div className="c-tarjeta"><h3>Por corporación y unidad</h3>
            <TablaGrupos titulo="Corporación" grupos={e.porCorporacion.map((g) => ({ ...g, nombre: CORPORACION[g.clave] ?? g.nombre }))} clave={false} testId="por-corporacion" />
            <TablaGrupos titulo="Unidad" grupos={e.porUnidad} clave={false} testId="por-unidad" />
          </div>
        </>}
        <p className="suave c-pequeno">{'Metas provisionales. Los mismos números salen en Modo A y Modo B porque se calculan de los folios.'}</p>
      </>}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporte mensual al SESNSP
// ─────────────────────────────────────────────────────────────────────────────

const mesAnterior = (mes: string) => { const [a, m] = mes.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
const seg = (x: number | null) => (x == null ? '—' : duracionTexto(x));

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** "2026-11" → "diciembre de 2026". */
function mesSiguienteTexto(mes: string) {
  const [a, m] = mes.split('-').map(Number);
  return m === 12 ? `enero de ${a + 1}` : `${MESES[m]} de ${a}`;
}

export function VistaSesnsp({ token }: { token: string }) {
  const [lista, setLista] = useState<ListaSesnsp | null>(null);
  const [mes, setMes] = useState('');
  const [d, setD] = useState<MesSesnsp | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const cargarLista = useCallback(() => { setError(''); api.sesnsp(token).then((l) => { setLista(l); setMes((m) => m || l.mesActual); }).catch((x) => setError(mensajeDe(x))); }, [token]);
  useEffect(cargarLista, [cargarLista]);
  const cargarMes = useCallback(() => { if (mes) { setD(null); api.sesnspMes(token, mes).then(setD).catch((x) => setError(mensajeDe(x))); } }, [token, mes]);
  useEffect(cargarMes, [cargarMes]);

  async function cerrar() {
    setAviso(''); setConfirmar(false);
    try { setD(await api.cerrarMes(token, mes, mes >= (lista?.mesActual ?? ''))); cargarLista(); } catch (x) { setAviso(mensajeDe(x)); }
  }
  async function bajar(a: 'reporte.csv' | 'ajustes.csv' | 'reporte.xlsx') {
    try { guardarArchivo(await api.archivoSesnsp(token, mes, a)); } catch (x) { setAviso(mensajeDe(x)); }
  }

  if (error) return <section className="c-panel"><Error texto={error} alReintentar={() => { cargarLista(); cargarMes(); }} /></section>;
  if (!lista) return <section className="c-panel"><Cargando texto="Cargando reporte SESNSP…" /></section>;
  const meses = [...new Set([lista.mesActual, mesAnterior(lista.mesActual), mesAnterior(mesAnterior(lista.mesActual)), ...lista.cierres.map((c) => c.mes)])].sort().reverse();
  const enCurso = mes >= lista.mesActual;
  return (
    <section className="c-panel c-panel-ancho" aria-label="Reporte mensual al SESNSP">
      <div className="c-fila">
        <h2>Reporte mensual al SESNSP</h2>
        <label className="c-campo c-campo-linea">Mes<select value={mes} onChange={(x) => setMes(x.target.value)}>{meses.map((m) => <option key={m} value={m}>{`${m}${lista.cierres.some((c) => c.mes === m) ? ' · cerrado' : ''}`}</option>)}</select></label>
      </div>
      <p className="suave c-pequeno">{`Agregado por mes, clave de municipio (5 dígitos) y código CNIE. Sin datos personales. ${lista.nota}`}</p>
      {aviso && <div className="c-aviso" role="alert"><span>{aviso}</span><button className="c-enlace" onClick={() => setAviso('')}>Cerrar</button></div>}
      {!d && <Cargando texto="Cargando mes…" />}
      {d && <>
        <div className="c-fila">
          <span className={`c-chip ${d.estado === 'cerrado' ? 'c-chip-ok' : 'c-chip-aviso'}`} data-testid="estado-sesnsp">{d.estado === 'cerrado' ? `Cerrado el ${new Date(d.cerradoEn!).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}: valores congelados${d.prueba ? ' (cierre de prueba de la demo)' : ''}` : enCurso ? 'Borrador: el mes sigue en curso' : 'Borrador: listo para cerrar'}</span>
          <div className="c-botones">
            <button className="c-boton-sec" onClick={() => void bajar('reporte.csv')}>CSV</button>
            <button className="c-boton-sec" onClick={() => void bajar('reporte.xlsx')}>Excel</button>
            {d.ajustes.length > 0 && <button className="c-boton-sec" onClick={() => void bajar('ajustes.csv')}>Ajustes (CSV)</button>}
            {d.estado === 'borrador' && !enCurso && !confirmar && <button className="c-boton" onClick={() => setConfirmar(true)}>Cerrar el mes</button>}
            {d.estado === 'borrador' && enCurso && lista.cierreDePrueba && !confirmar && <button className="c-boton-sec" onClick={() => setConfirmar(true)}>Probar el cierre (solo demo)</button>}
          </div>
        </div>
        <p className="suave c-pequeno" data-testid="explica-sesnsp">{d.estado === 'cerrado'
          ? `Corte congelado: total, procedentes, improcedentes y medianas ya no cambian. Dos exportaciones de este mes dan el mismo archivo. Un cambio posterior a un folio de ${mes} sale como ajuste en el mes siguiente. Los archivos se llaman sesnsp-${mes}-cerrado.`
          : enCurso
            ? `Mientras el mes sigue en curso, los valores pueden cambiar cuando los folios avanzan o se corrigen (las medianas solo cuentan etapas terminadas). Se cierra a partir del 1 de ${mesSiguienteTexto(mes)}. Los archivos se llaman sesnsp-${mes}-borrador.`
            : `El mes ya terminó: al cerrarlo, sus valores quedan congelados. Los archivos se llaman sesnsp-${mes}-borrador hasta el cierre.`}</p>
        {confirmar && (
          <div className="c-aviso" role="alertdialog" aria-label="Confirmar cierre">
            <span>{enCurso
              ? `Solo en la demo: se cierra ${mes} aunque siga en curso, para probar el corte congelado. En el servicio real solo se cierran meses terminados.`
              : `Al cerrar ${mes} el reporte queda congelado. Una corrección posterior sale como ajuste en el mes siguiente, con nota.`}</span>
            <span className="c-aviso-acciones"><button className="c-boton" onClick={() => void cerrar()}>Cerrar {mes}</button><button className="c-enlace" onClick={() => setConfirmar(false)}>Cancelar</button></span>
          </div>
        )}
        {!d.filas.length ? (
          <div className="estado c-tarjeta"><span className="estado-icono" aria-hidden="true">○</span><h3>{`Sin reportes en ${mes}`}</h3><p>{DEMO ? `La demo solo guarda reportes de las últimas horas; levanta algunos y aparecen en ${lista.mesActual}.` : 'No hubo folios levantados ese mes.'}</p></div>
        ) : (
          <div className="c-tabla-desliza">
            <table className="c-tiempos c-sesnsp" data-testid="tabla-sesnsp">
              <thead>
                <tr><th scope="col" rowSpan={2}>Clave</th><th scope="col" rowSpan={2}>Municipio</th><th scope="col" rowSpan={2}>CNIE</th><th scope="col" rowSpan={2}>Total</th><th scope="col" rowSpan={2}>Proce&shy;dentes</th><th scope="col" rowSpan={2}>Improce&shy;dentes o cancelados</th><th scope="colgroup" colSpan={5} className="c-grupo-col">Mediana por etapa</th></tr>
                <tr><th scope="col">Recepción</th><th scope="col">Asignación</th><th scope="col">Salida</th><th scope="col">Traslado</th><th scope="col">Llegada</th></tr>
              </thead>
              <tbody>
                {d.filas.map((f) => (
                  <tr key={`${f.claveMunicipio}-${f.incidente || f.subtipo}`}>
                    <td className="c-mono">{f.claveMunicipio || '—'}</td>
                    <td>{f.municipio}</td>
                    <th scope="row"><span className="c-mono">{f.incidente || f.subtipo || '—'}</span><div className="suave c-pequeno">{f.incidenteNombre || f.subtipoNombre}</div></th>
                    <td>{f.total}</td><td>{f.procedentes}</td><td>{f.improcedentesCancelados}</td>
                    <td>{seg(f.medianas.recepcion)}</td><td>{seg(f.medianas.asignacion)}</td><td>{seg(f.medianas.salida)}</td><td>{seg(f.medianas.traslado)}</td><td>{seg(f.medianas.llegada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.ajustes.length > 0 && (
          <div className="c-tarjeta">
            <h3>Correcciones a meses ya cerrados</h3>
            <ul className="c-lista-plana">{d.ajustes.map((a, i) => <li key={i}><strong>{`${a.mesOrigen} · ${a.claveMunicipio} · CNIE ${a.cnie}: `}</strong>{`total ${a.deltaTotal >= 0 ? '+' : ''}${a.deltaTotal}, procedentes ${a.deltaProcedentes >= 0 ? '+' : ''}${a.deltaProcedentes}, improcedentes o cancelados ${a.deltaImprocedentesCancelados >= 0 ? '+' : ''}${a.deltaImprocedentesCancelados}`}<div className="suave c-pequeno">{a.nota}</div></li>)}</ul>
          </div>
        )}
        <p className="suave c-pequeno">{`Medianas por etapa en hora de Querétaro, con metas provisionales. Columnas para el CNI/SESNSP y el ${NOMBRE_RESPALDO_ESTATAL}; el formato oficial está por confirmar con el ${NOMBRE_RESPALDO_ESTATAL}.`}</p>
      </>}
    </section>
  );
}
