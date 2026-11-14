'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import '../consola/consola.css';
import './demo.css';
import { AVISO_DEMO, CODIGO_SMS_DEMO } from '../../lib/demo/textos';
import * as demo from '../../lib/demo/motor';
import type { ReporteDemo } from '../../lib/demo/motor';

type Respuesta = string | number | boolean;
interface Ciudadano { nombre: string; telefono: string }

const CLAVE_CIUDADANO = 'poliaq.demo.ciudadano';
const CLAVE_FOLIO = 'poliaq.demo.folio';
const FINALES = ['cerrado', 'improcedente', 'cancelado'];
const PASOS = ['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado'] as const;

function leerLocal<T>(clave: string): T | null {
  try { const t = localStorage.getItem(clave); return t ? (JSON.parse(t) as T) : null; } catch { return null; }
}
function guardarLocal(clave: string, v: unknown) {
  try { if (v === null) localStorage.removeItem(clave); else localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

export default function DemoCiudadano() {
  const [listo, setListo] = useState(false);
  const [ciudadano, setCiudadano] = useState<Ciudadano | null>(null);
  const [folio, setFolio] = useState<string | null>(null);

  useEffect(() => {
    setCiudadano(leerLocal<Ciudadano>(CLAVE_CIUDADANO));
    setFolio(leerLocal<string>(CLAVE_FOLIO));
    setListo(true);
  }, []);

  const elegirFolio = (f: string | null) => { guardarLocal(CLAVE_FOLIO, f); setFolio(f); };

  function borrar() {
    demo.borrarTodo();
    guardarLocal(CLAVE_CIUDADANO, null);
    elegirFolio(null);
    setCiudadano(null);
  }

  return (
    <main className="d-main">
      <p className="c-demo">{AVISO_DEMO}</p>
      <header className="d-cabecera">
        <h1>Pol-IAQ · app ciudadana</h1>
        <nav className="d-nav">
          <Link href="/consola/" target="_blank">Abrir la consola del operador ↗</Link>
          <button className="c-enlace" onClick={borrar}>Borrar datos de la demo</button>
        </nav>
      </header>
      {!listo ? null : !ciudadano ? (
        <Registro alRegistrar={(c) => { guardarLocal(CLAVE_CIUDADANO, c); setCiudadano(c); }} />
      ) : folio && demo.reporte(folio) ? (
        <Seguimiento folio={folio} alNuevo={() => elegirFolio(null)} />
      ) : (
        <NuevoReporte ciudadano={ciudadano} alCrear={elegirFolio} />
      )}
    </main>
  );
}

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
      <h2>1. Regístrate</h2>
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
      <button className="c-boton">{enviado ? 'Entrar' : 'Enviar código'}</button>
    </form>
  );
}

function NuevoReporte({ ciudadano, alCrear }: { ciudadano: Ciudadano; alCrear: (folio: string) => void }) {
  const [incidenteId, setIncidenteId] = useState('robo-en-curso');
  const [lugarId, setLugarId] = useState(demo.LUGARES_DEMO[0].id);
  const [descripcion, setDescripcion] = useState('');
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [automatico, setAutomatico] = useState(true);
  const [error, setError] = useState('');

  const incidente = demo.CATALOGO.find((i) => i.id === incidenteId) ?? demo.CATALOGO[0];
  const preguntas = useMemo(() => demo.preguntasPara(incidente.id, respuestas), [incidente.id, respuestas]);
  const categorias = useMemo(() => [...new Set(demo.CATALOGO.map((i) => i.categoria))], []);

  const responder = (id: string, v: Respuesta | undefined) => setRespuestas((r) => {
    const n = { ...r };
    if (v === undefined || v === '') delete n[id]; else n[id] = v;
    return n;
  });

  function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const vigentes = new Set(preguntas.map((q) => q.id));
      const r = demo.crearReporte({
        incidenteId: incidente.id,
        lugarId,
        descripcion,
        respuestas: Object.entries(respuestas).filter(([k]) => vigentes.has(k)).map(([preguntaId, respuesta]) => ({ preguntaId, respuesta })),
        nombre: ciudadano.nombre,
        telefono: ciudadano.telefono,
        cadSimulado: automatico,
      });
      alCrear(r.folio);
    } catch (err) {
      setError(err instanceof demo.ErrorDemo ? `No se pudo crear el reporte (${err.codigo}).` : 'No se pudo crear el reporte.');
    }
  }

  return (
    <form className="c-tarjeta c-form d-form" onSubmit={crear}>
      <h2>2. Reporta (datos de prueba)</h2>
      <p className="suave d-nota">Hola, {ciudadano.nombre}. Elige un incidente del catálogo y una ubicación de prueba.</p>
      <label>¿Qué está pasando?
        <select value={incidenteId} onChange={(e) => { setIncidenteId(e.target.value); setRespuestas({}); }}>
          {categorias.map((c) => (
            <optgroup key={c} label={CATEGORIA[c] ?? c}>
              {demo.CATALOGO.filter((i) => i.categoria === c).map((i) => <option key={i.id} value={i.id}>{i.nombreCiudadano}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label>¿Dónde? (ubicación simulada)
        <select value={lugarId} onChange={(e) => setLugarId(e.target.value)}>
          {demo.LUGARES_DEMO.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
      </label>
      {preguntas.length > 0 && (
        <fieldset className="d-preguntas">
          <legend>Preguntas de la despachadora</legend>
          {preguntas.map((q) => (
            <div key={q.id} className="d-pregunta">
              <span>{q.texto}</span>
              {q.tipo === 'si_no' ? (
                <div className="d-opciones" role="group" aria-label={q.texto}>
                  {[['Sí', true], ['No', false], ['No sé', 'no_sabe']].map(([t, v]) => (
                    <button type="button" key={String(t)} className={`d-opcion ${respuestas[q.id] === v ? 'sel' : ''}`} onClick={() => responder(q.id, v as Respuesta)}>{t as string}</button>
                  ))}
                </div>
              ) : q.tipo === 'opcion' ? (
                <select value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value || undefined)} aria-label={q.texto}>
                  <option value="">Sin contestar</option>
                  {q.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                  <option value="no_sabe">No sé</option>
                </select>
              ) : q.tipo === 'numero' ? (
                <input type="number" min={0} value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value === '' ? undefined : Number(e.target.value))} aria-label={q.texto} />
              ) : (
                <input value={String(respuestas[q.id] ?? '')} onChange={(e) => responder(q.id, e.target.value)} aria-label={q.texto} maxLength={200} />
              )}
            </div>
          ))}
        </fieldset>
      )}
      <label>Detalles (opcional)<textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} maxLength={300} placeholder="Texto de prueba" /></label>
      <fieldset className="d-modo">
        <legend>¿Quién despacha?</legend>
        <label className="c-check"><input type="radio" checked={automatico} onChange={() => setAutomatico(true)} /> <span>El CAD simulado (avanza solo hasta cerrar en ~30 s)</span></label>
        <label className="c-check"><input type="radio" checked={!automatico} onChange={() => setAutomatico(false)} /> <span>Yo, desde la consola del operador</span></label>
      </fieldset>
      {error && <p className="c-error" role="alert">{error}</p>}
      <button className="c-boton d-enviar">Enviar reporte</button>
    </form>
  );
}

const CATEGORIA: Record<string, string> = { seguridad: 'Seguridad', medico: 'Emergencia médica', proteccion_civil: 'Protección Civil', servicios_publicos: 'Servicios públicos' };

function Seguimiento({ folio, alNuevo }: { folio: string; alNuevo: () => void }) {
  const [r, setR] = useState<ReporteDemo | undefined>(() => demo.reporte(folio));
  const [texto, setTexto] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    setR(demo.reporte(folio));
    const quitar = demo.escuchar(() => setR(demo.reporte(folio)));
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => { quitar(); clearInterval(t); };
  }, [folio]);

  if (!r) return <p>El reporte ya no existe. <button className="c-enlace" onClick={alNuevo}>Crear otro</button></p>;
  const final = FINALES.includes(r.estado);
  const incidente = demo.CATALOGO.find((i) => i.id === r.incidenteId);
  const indice = PASOS.indexOf(r.estado as (typeof PASOS)[number]);
  const recomendaciones = demo.recomendacionesPara(r.incidenteId);
  const escalaEn = r.estado === 'recibido' && !r.folioCad && !r.cadSimulado && r.cadId !== 'c5-queretaro'
    ? Math.max(0, Math.ceil((new Date(r.creadoEn).getTime() + demo.ESPERA_ACUSE_SEG * 1000 - ahora) / 1000))
    : null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    try { demo.mensajeCiudadano(folio, texto.trim()); setTexto(''); } catch { /* reporte finalizado */ }
  }

  return (
    <section className="d-seguimiento">
      <div className="c-tarjeta">
        <p className="suave d-nota">Tu folio unificado</p>
        <p className="d-folio" data-testid="folio">{r.folio}</p>
        <p className="d-nota">{incidente?.nombreCiudadano} · {r.ubicacion.referencia}</p>
        <p className="d-nota">Atiende: <strong>{demo.nombreCad(r.cadId)}</strong>{r.folioCad ? <> · folio del CAD {r.folioCad}</> : null}</p>
        <p className={`d-estado d-${r.estado}`} data-testid="estado">{demo.etiquetaCiudadano(r.estado)}</p>
        {escalaEn !== null && (
          <p className="suave d-nota">Esperando que un operador lo reciba en la <Link href="/consola/" target="_blank">consola</Link>. Si nadie lo recibe en {escalaEn} s, pasa al C5 con el mismo folio.</p>
        )}
        {!final || r.estado === 'cerrado' ? (
          <ol className="d-pasos" aria-label="Avance">
            {PASOS.map((p, i) => <li key={p} className={i <= indice ? 'hecho' : ''}>{demo.etiquetaCiudadano(p)}</li>)}
          </ol>
        ) : null}
        {r.unidad && (
          <div className="d-unidad">
            <strong>{r.unidad.etiqueta}</strong>
            <span className="suave"> · {r.estado === 'en_sitio' || r.estado === 'cerrado' ? 'en el lugar' : r.unidad.etaMinutos != null ? `llega en ~${r.unidad.etaMinutos} min` : 'asignada'}</span>
            {r.unidad.etaMinutos != null && !final && (
              <div className="d-barra" aria-hidden><span style={{ width: `${Math.max(8, 100 - (r.unidad.etaMinutos / 6) * 100)}%` }} /></div>
            )}
          </div>
        )}
        {!final && <button className="c-boton-sec d-cancelar" onClick={() => { try { demo.cancelar(folio); } catch { /* ya finalizado */ } }}>Cancelar reporte</button>}
        {final && <button className="c-boton" onClick={alNuevo}>Hacer otro reporte</button>}
      </div>

      {recomendaciones.length > 0 && !final && (
        <div className="c-tarjeta">
          <h3>Mientras llega la unidad</h3>
          <ul>{recomendaciones.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

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

      <div className="c-tarjeta">
        <h3>Historial</h3>
        <ul className="d-historial">
          {[...r.historial].reverse().map((h, i) => (
            <li key={i}><span className="suave">{new Date(h.en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {demo.etiquetaCiudadano(h.estado)}{h.nota ? ` · ${h.nota}` : ''}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
