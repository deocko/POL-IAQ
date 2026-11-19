'use client';

/**
 * «Iniciar nuevo reporte»: alta en la consola de un reporte que llegó por teléfono al 911.
 * Mismo procedimiento de preguntas y respuestas que la app ciudadana, capturado por el operador:
 * 1) número (¿ya es reportante?), 2) tipo de incidente y descripción, 3) ubicación, 4) preguntas del
 * protocolo, 5) clasificación CNIE y prioridad, 6) ¿celular o fijo? En la ubicación se elige la colonia (catálogo
 * SEPOMEX) o se agrega a mano con su CP y su ubicación, marcada «manual». El folio sale con el mismo
 * formato, enrutado e historial que uno de la app, marcado con origen 911.
 */
import { useMemo, useState } from 'react';
import {
  CATALOGO_SEMILLA, buscarCnie, canalizar, clasificarCnie, coloniaPorId, esMalUso, etiquetaCnie, incidenteCnie, municipioEn, nombreLegible,
  type ColoniaEntrada, type IncidenteCnie, type TipoTelefono,
} from '@pol-iaq/shared/movil';
import * as demo from '../../lib/demo/motor';
import { DEMO, ErrorApi, ERRORES, api, type ConsultaReportante, type Prioridad, type Reporte } from './consola';
import { CapturaColonia, textoEntrada } from './colonia';

type Respuesta = string | number | boolean;
const mensaje = (e: unknown) => (e instanceof ErrorApi ? ERRORES[e.codigo] ?? e.mensaje ?? `Error (${e.codigo})` : 'Sin conexión con el API.');
const PASOS = ['Teléfono', 'Incidente', 'Ubicación', 'Preguntas', 'Clasificación', 'Tipo de línea'] as const;

export function Alta911({ token, municipios, alCrear, alCancelar }: { token: string; municipios: readonly string[] | null; alCrear: (r: Reporte, nuevo: boolean) => void; alCancelar: () => void }) {
  const [paso, setPaso] = useState(0);
  const [telefono, setTelefono] = useState('');
  const [consulta, setConsulta] = useState<ConsultaReportante | null>(null);
  const [nombre, setNombre] = useState('');
  const [incidenteId, setIncidenteId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [lugarId, setLugarId] = useState(demo.LUGARES_DEMO[0].id);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [referencia, setReferencia] = useState('');
  const [colonia, setColonia] = useState<ColoniaEntrada | null>(null);
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [busquedaCnie, setBusquedaCnie] = useState('');
  const [codigoCnie, setCodigoCnie] = useState<IncidenteCnie | null>(null);
  const [prioridad, setPrioridad] = useState<Prioridad | ''>('');
  const [tipoTelefono, setTipoTelefono] = useState<TipoTelefono | ''>('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const incidente = CATALOGO_SEMILLA.find((i) => i.id === incidenteId);
  const preguntas = useMemo(() => (incidenteId ? demo.preguntasPara(incidenteId, respuestas) : []), [incidenteId, respuestas]);
  const vigentes = useMemo(() => Object.fromEntries(Object.entries(respuestas).filter(([k]) => preguntas.some((q) => q.id === k))), [respuestas, preguntas]);
  const cnieAuto = useMemo(() => { try { return incidenteId ? clasificarCnie(incidenteId, vigentes) : null; } catch { return null; } }, [incidenteId, vigentes]);
  const prioridadAuto = incidente ? canalizar(demo.PROTOCOLO, incidente, vigentes).prioridad : null;
  const resultadosCnie = useMemo(() => buscarCnie(busquedaCnie, 8).filter((i) => !esMalUso(i.codigo)), [busquedaCnie]);
  const destino = DEMO ? demo.destinoDeLugar(lugarId).texto : null;
  // Municipio de la ubicación: con él, el selector solo ofrece las colonias de ese municipio.
  const lugar = DEMO ? demo.LUGARES_DEMO.find((l) => l.id === lugarId) : null;
  const municipioUbicacion = DEMO ? lugar?.clave ?? null : (lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? municipioEn(Number(lat), Number(lng))?.clave ?? null : null);
  const coloniaDelLugar = lugar?.coloniaId ? coloniaPorId(lugar.coloniaId) : null;
  const coloniaResumen = colonia ? textoEntrada(colonia) : coloniaDelLugar ? `${coloniaDelLugar.nombre} · CP ${coloniaDelLugar.cp}` : 'sin colonia';

  const responder = (id: string, v: Respuesta | undefined) => setRespuestas((r) => {
    const n = { ...r };
    if (v === undefined || v === '' || n[id] === v) delete n[id]; else n[id] = v;
    return n;
  });

  async function validarTelefono(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setOcupado(true);
    try {
      const c = await api.reportante(token, telefono);
      setConsulta(c);
      setNombre(c.registrado ? c.reportante.nombre : '');
    } catch (err) { setError(mensaje(err)); setConsulta(null); } finally { setOcupado(false); }
  }

  function puedeSeguir(): string | null {
    if (paso === 0) return !consulta ? 'Valida el número primero.' : nombre.trim().length < 2 ? 'Escribe el nombre de quien llama.' : null;
    if (paso === 1) return incidente ? null : 'Elige el tipo de incidente.';
    if (paso === 2) return DEMO || (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat && lng) ? null : 'Escribe latitud y longitud.';
    if (paso === 4) return incidentesSinCodigo() ? 'Para «Otra emergencia» asigna el incidente CNIE.' : null;
    return null;
  }
  const incidentesSinCodigo = () => incidenteId === 'otro' && !codigoCnie;

  async function crear() {
    if (!tipoTelefono) { setError('Indica si la llamada fue de celular o de teléfono fijo.'); return; }
    setError(''); setOcupado(true);
    try {
      const { reporte, reportanteNuevo } = await api.alta911(token, {
        telefono: consulta!.telefono, nombre: nombre.trim(), tipoTelefono, incidenteId,
        ...(descripcion.trim() && { descripcion: descripcion.trim() }),
        ...(DEMO ? { lugarId } : { ubicacion: { lat: Number(lat), lng: Number(lng), ...(referencia.trim() && { referencia: referencia.trim() }) } }),
        respuestas: Object.entries(vigentes).map(([preguntaId, respuesta]) => ({ preguntaId, respuesta })),
        ...(prioridad && { prioridad }),
        ...(codigoCnie && { codigoCnie: codigoCnie.codigo }),
        ...(colonia && { colonia }),
      });
      alCrear(reporte, reportanteNuevo);
    } catch (err) { setError(mensaje(err)); } finally { setOcupado(false); }
  }

  const siguiente = () => { const x = puedeSeguir(); if (x) { setError(x); return; } setError(''); setPaso((p) => p + 1); };
  const cnieFinal = codigoCnie ? etiquetaCnie({ tipo: codigoCnie.tipo, subtipo: codigoCnie.subtipo, incidente: codigoCnie, prioridad: codigoCnie.prioridad }) : cnieAuto ? etiquetaCnie(cnieAuto) : 'Sin código: asígnalo abajo.';

  return (
    <section className="c-detalle c-alta911" aria-label="Iniciar nuevo reporte por llamada al 911" data-testid="alta-911">
      <div className="c-fila">
        <button className="c-boton-sec c-volver" onClick={alCancelar} data-testid="atras">← Atrás</button>
        <span className="c-chip c-chip-911">Llamada 911</span>
      </div>
      <div className="c-tarjeta">
        <h2>Iniciar nuevo reporte</h2>
        <ol className="c-pasos" aria-label="Pasos">
          {PASOS.map((p, i) => <li key={p} className={i === paso ? 'actual' : i < paso ? 'hecho' : ''} aria-current={i === paso ? 'step' : undefined}>{p}</li>)}
        </ol>

        {paso === 0 && (
          <form className="c-form c-form-columna" onSubmit={validarTelefono}>
            <label className="c-campo">Número telefónico de quien llama
              <input value={telefono} onChange={(e) => { setTelefono(e.target.value); setConsulta(null); }} inputMode="tel" autoComplete="off" placeholder="10 dígitos" data-testid="alta-telefono" autoFocus />
            </label>
            <button className="c-boton-sec" disabled={ocupado || telefono.replace(/\D/g, '').length < 10} data-testid="alta-validar">Validar número</button>
            {consulta?.registrado && (
              <div className="c-nota" data-testid="reportante-registrado">
                <strong>{`Reportante registrado: ${consulta.reportante.nombre}`}</strong>
                <div className="suave c-pequeno">{`Alta por ${consulta.reportante.origen === '911' ? 'llamada al 911' : 'la app'} · ${consulta.reportante.folios} ${consulta.reportante.folios === 1 ? 'folio' : 'folios'} con este número`}</div>
                <label className="c-campo">Nombre (corrígelo si cambió)<input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} /></label>
              </div>
            )}
            {consulta && !consulta.registrado && (
              <div className="c-nota" data-testid="reportante-nuevo">
                <strong>Número no registrado.</strong>
                <div className="suave c-pequeno">Sigue con el reporte; al final se da de alta al reportante con estos datos.</div>
                <label className="c-campo">Nombre de quien llama<input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} data-testid="alta-nombre" /></label>
              </div>
            )}
          </form>
        )}

        {paso === 1 && (
          <div className="c-form-columna">
            <fieldset className="c-opciones-incidente" aria-label="Tipo de incidente">
              {CATALOGO_SEMILLA.map((i) => (
                <button type="button" key={i.id} className={`c-filtro ${incidenteId === i.id ? 'sel' : ''}`} aria-pressed={incidenteId === i.id} onClick={() => { setIncidenteId(i.id); setRespuestas({}); setCodigoCnie(null); }} data-incidente={i.id}>{i.nombreCiudadano}</button>
              ))}
            </fieldset>
            <label className="c-campo">Descripción (lo que cuenta quien llama)
              <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={1000} data-testid="alta-descripcion" />
            </label>
          </div>
        )}

        {paso === 2 && (DEMO ? (
          <div className="c-form-columna">
            <label className="c-campo">Ubicación (lugar de prueba de la demo)
              <select value={lugarId} onChange={(e) => setLugarId(e.target.value)} data-testid="alta-lugar">
                {demo.LUGARES_DEMO.map((l) => <option key={l.id} value={l.id}>{`${l.nombre} · ${l.referencia}`}</option>)}
              </select>
            </label>
            {destino && <p className="c-nota c-pequeno" data-testid="alta-destino">{`${destino}. El folio sale con la clave de ese municipio.`}</p>}
            <CapturaColonia key={`col-${lugarId}`} municipioClave={municipioUbicacion} municipios={municipios} valor={colonia} alElegir={setColonia} etiqueta="Colonia (opcional)" />
            {!colonia && <p className="suave c-pequeno">{coloniaDelLugar ? `Si no eliges otra, se guarda la del lugar de prueba: ${coloniaDelLugar.nombre} · CP ${coloniaDelLugar.cp}.` : 'Si no la eliges, el folio queda «Sin colonia» y se puede asignar después.'}</p>}
          </div>
        ) : (
          <div className="c-form-columna">
            <div className="c-form">
              <label className="c-campo">Latitud<input value={lat} onChange={(e) => { setLat(e.target.value); setColonia(null); }} inputMode="decimal" /></label>
              <label className="c-campo">Longitud<input value={lng} onChange={(e) => { setLng(e.target.value); setColonia(null); }} inputMode="decimal" /></label>
              <label className="c-campo">Referencia<input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={280} /></label>
            </div>
            <CapturaColonia municipioClave={municipioUbicacion} municipios={municipios} valor={colonia} alElegir={setColonia} etiqueta="Colonia (opcional)" />
            {!colonia && <p className="suave c-pequeno">{'Si no la eliges, el folio queda «Sin colonia» (salvo que la referencia diga «Col. …» o «C.P. …») y se puede asignar después.'}</p>}
          </div>
        ))}

        {paso === 3 && (
          <div className="c-form-columna" data-testid="alta-preguntas">
            {!preguntas.length && <p className="suave">Este incidente no tiene preguntas en el protocolo.</p>}
            {preguntas.map((q) => (
              <div key={q.id} className="c-pregunta">
                <span id={`q-${q.id}`}>{q.texto}</span>
                {q.tipo === 'si_no' ? (
                  <div className="c-botones" role="group" aria-labelledby={`q-${q.id}`}>
                    {([['Sí', true], ['No', false], ['No sabe', 'no_sabe']] as const).map(([t, v]) => <button type="button" key={t} className={`c-filtro ${respuestas[q.id] === v ? 'sel' : ''}`} aria-pressed={respuestas[q.id] === v} onClick={() => responder(q.id, v)}>{t}</button>)}
                  </div>
                ) : q.tipo === 'opcion' ? (
                  <select value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value || undefined)} aria-labelledby={`q-${q.id}`}>
                    <option value="">Sin contestar</option>
                    {q.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                    <option value="no_sabe">No sabe</option>
                  </select>
                ) : q.tipo === 'numero' ? (
                  <input type="number" min={0} value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value === '' ? undefined : Number(e.target.value))} aria-labelledby={`q-${q.id}`} />
                ) : (
                  <input value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value)} maxLength={200} aria-labelledby={`q-${q.id}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {paso === 4 && (
          <div className="c-form-columna">
            <p data-testid="alta-cnie"><strong>CNIE:</strong> {cnieFinal}</p>
            <label className="c-campo">{incidenteId === 'otro' ? 'Asigna el incidente CNIE' : 'Cambiar el código (opcional)'}
              <input type="search" value={busquedaCnie} onChange={(e) => setBusquedaCnie(e.target.value)} placeholder="Busca por nombre o código" autoComplete="off" />
            </label>
            {busquedaCnie.trim() && (
              <ul className="c-cnie-resultados">
                {resultadosCnie.map((i) => (
                  <li key={i.codigo}><button type="button" onClick={() => { setCodigoCnie(i); setBusquedaCnie(''); }}><span className="c-linea"><strong>{i.codigo}</strong><span>{nombreLegible(i.nombre)}</span></span><span className="suave c-pequeno">{`${i.tipo.nombre} · ${i.prioridad}`}</span></button></li>
                ))}
              </ul>
            )}
            {codigoCnie && <button type="button" className="c-enlace" onClick={() => setCodigoCnie(null)}>Volver al código automático</button>}
            <p className="suave c-pequeno">{'«Mal Uso del servicio» no se asigna al crear: se recataloga después, al verificar el reporte.'}</p>
            <label className="c-campo">Prioridad operativa
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad | '')} data-testid="alta-prioridad">
                <option value="">{`Según el protocolo: ${prioridadAuto ?? '—'}`}</option>
                <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
              </select>
            </label>
          </div>
        )}

        {paso === 5 && (
          <div className="c-form-columna">
            <p><strong>¿La llamada fue de número celular o de teléfono fijo?</strong></p>
            <div className="c-botones" role="radiogroup" aria-label="Tipo de línea">
              {(['celular', 'fijo'] as const).map((t) => <button type="button" role="radio" aria-checked={tipoTelefono === t} key={t} className={`c-filtro ${tipoTelefono === t ? 'sel' : ''}`} onClick={() => setTipoTelefono(t)} data-tipo-telefono={t}>{t === 'celular' ? 'Celular' : 'Teléfono fijo'}</button>)}
            </div>
            <div className="c-tarjeta c-resumen-alta" data-testid="alta-resumen">
              <div>{`${nombre.trim()} · ${consulta?.telefono} · ${consulta?.registrado ? 'reportante registrado' : 'se dará de alta como reportante'}`}</div>
              <div>{`${incidente?.nombreCiudadano ?? ''} · ${cnieFinal}`}</div>
              <div>{`Prioridad ${prioridad || prioridadAuto}${DEMO ? ` · ${demo.LUGARES_DEMO.find((l) => l.id === lugarId)?.nombre}` : ''}`}</div>
              <div data-testid="alta-resumen-colonia">{`Colonia: ${coloniaResumen}`}</div>
            </div>
          </div>
        )}

        {error && <p className="c-error" role="alert">{error}</p>}
        <div className="c-botones c-pie-alta">
          {paso > 0 && <button type="button" className="c-boton-sec" onClick={() => { setError(''); setPaso((p) => p - 1); }}>Atrás</button>}
          {paso < PASOS.length - 1
            ? <button type="button" className="c-boton" onClick={siguiente} data-testid="alta-siguiente">Siguiente</button>
            : <button type="button" className="c-boton" disabled={ocupado} onClick={() => void crear()} data-testid="alta-crear">Crear folio</button>}
          <button type="button" className="c-enlace" onClick={alCancelar}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}

/** Para el detalle: «Llamada 911 · celular». */
export const textoOrigen = (r: Pick<Reporte, 'origen' | 'tipoTelefono' | 'ruta'>) =>
  r.origen === '911' ? `Llamada 911${r.tipoTelefono ? ` · ${r.tipoTelefono === 'fijo' ? 'teléfono fijo' : 'celular'}` : ''}` : r.ruta?.canal === '089' ? 'Anónimo (089)' : 'App ciudadana';

export const nombreIncidenteCnie = (c: string) => (incidenteCnie(c) ? nombreLegible(incidenteCnie(c)!.nombre) : c);
