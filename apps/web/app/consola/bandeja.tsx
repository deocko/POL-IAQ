'use client';

/**
 * Bandeja del operador: filtros rápidos con contador (estado, prioridad operativa y CNIE, municipio y
 * tiempo de espera), orden por prioridad y demora, semáforo por demora y punto de prioridad en cada
 * fila. También la recatalogación a «Mal Uso del servicio» y los umbrales del semáforo.
 */
import { useMemo, useState } from 'react';
import {
  ETIQUETA_SEMAFORO, GRUPOS_ESTADO, INCIDENTES_MAL_USO, MUNICIPIOS_QRO, ORDENES_BANDEJA, UMBRALES_SEMAFORO_PREDETERMINADOS,
  contadoresBandeja, duracionTexto, esMalUso, filtrarBandeja, grupoEstado, nombreLegible, ordenarBandeja, semaforoDe, tipoCnie, validarUmbrales,
  type ColorSemaforo, type FiltroBandeja, type OrdenBandeja, type Semaforo, type UmbralesSemaforo,
} from '@pol-iaq/shared/movil';
import { DEMO, hora, type Accion, type Reporte } from './consola';

/** «Activos» (nuevos + pendientes) es la vista por defecto; los atendidos se ven con su filtro. */
export type EstadoVista = 'activos' | 'nuevos' | 'pendientes' | 'atendidos' | 'todos';
export interface FiltroVista extends Omit<FiltroBandeja, 'estado'> { estado: EstadoVista }
export const FILTRO_INICIAL: FiltroVista = { estado: 'activos' };

const aFiltro = (f: FiltroVista): FiltroBandeja => ({ ...f, estado: f.estado === 'activos' || f.estado === 'todos' ? null : f.estado });

/** Aplica los filtros y el orden; devuelve también los contadores de cada opción. */
export function usarBandeja(reportes: Reporte[], filtro: FiltroVista, orden: OrdenBandeja, ahora: number, umbrales: UmbralesSemaforo) {
  return useMemo(() => {
    const base = aFiltro(filtro);
    const activos = (r: Reporte) => filtro.estado !== 'activos' || grupoEstado(r.estado) !== 'atendidos';
    const lista = ordenarBandeja(filtrarBandeja(reportes, base, ahora, umbrales).filter(activos), orden, ahora, umbrales);
    // Los contadores de los demás filtros se calculan sobre lo que deja ver el filtro de estado.
    const conEstado = reportes.filter(activos);
    const c = contadoresBandeja(conEstado, base, ahora, umbrales);
    const ce = contadoresBandeja(reportes, base, ahora, umbrales).estado;
    const estado: Record<EstadoVista, number> = {
      activos: (ce.nuevos ?? 0) + (ce.pendientes ?? 0), nuevos: ce.nuevos ?? 0, pendientes: ce.pendientes ?? 0, atendidos: ce.atendidos ?? 0, todos: ce['*'] ?? 0,
    };
    return { lista, contadores: { ...c, estado } };
  }, [reportes, filtro, orden, ahora, umbrales]);
}

type Contadores = ReturnType<typeof usarBandeja>['contadores'];

function Boton<T extends string>({ valor, actual, n, alElegir, children, clase = '' }: { valor: T | null; actual: T | null | undefined; n: number; alElegir: (v: T | null) => void; children: React.ReactNode; clase?: string }) {
  const sel = (actual ?? null) === valor;
  return (
    <button type="button" className={`c-filtro ${sel ? 'sel' : ''} ${clase}`} aria-pressed={sel} onClick={() => alElegir(sel && valor !== null ? null : valor)}>
      {children}<span className="c-filtro-n" data-testid="contador">{n}</span>
    </button>
  );
}

export function FiltrosBandeja({ filtro, alCambiar, orden, alOrden, contadores, supervision, umbrales }: {
  filtro: FiltroVista; alCambiar: (f: FiltroVista) => void; orden: OrdenBandeja; alOrden: (o: OrdenBandeja) => void; contadores: Contadores; supervision: boolean; umbrales: UmbralesSemaforo;
}) {
  const set = <K extends keyof FiltroVista>(k: K) => (v: FiltroVista[K] | null) => alCambiar({ ...filtro, [k]: v ?? (k === 'estado' ? 'activos' : null) });
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const hayFiltros = filtro.estado !== 'activos' || filtro.prioridad || filtro.prioridadCnie || filtro.municipio || filtro.demora;
  return (
    <div className="c-filtros-bandeja" role="group" aria-label="Filtros rápidos de la bandeja" data-testid="filtros-bandeja">
      <div className="c-grupo-filtro" role="group" aria-label="Estado">
        <span className="c-grupo-titulo">Estado</span>
        {(['activos', ...GRUPOS_ESTADO.map((g) => g.id), 'todos'] as EstadoVista[]).map((e) => (
          <Boton key={e} valor={e} actual={filtro.estado} n={contadores.estado[e]} alElegir={(v) => set('estado')(v ?? 'activos')}>
            {e === 'activos' ? 'Activos' : e === 'todos' ? 'Todos' : GRUPOS_ESTADO.find((g) => g.id === e)!.nombre}
          </Boton>
        ))}
      </div>
      <div className="c-grupo-filtro" role="group" aria-label="Prioridad operativa">
        <span className="c-grupo-titulo" title="La que usa POL-IAQ para despachar, según las respuestas">Prioridad</span>
        {(['alta', 'media', 'baja'] as const).map((p) => (
          <Boton key={p} valor={p} actual={filtro.prioridad} n={contadores.prioridad[p] ?? 0} alElegir={set('prioridad')}><span className={`c-prio c-prio-${p}`} aria-hidden="true" />{p}</Boton>
        ))}
      </div>
      <div className="c-grupo-filtro" role="group" aria-label="Prioridad CNIE">
        <span className="c-grupo-titulo" title="Prioridad oficial del CNIE V 3.0">CNIE</span>
        {(['ALTA', 'MEDIA', 'BAJA'] as const).map((p) => (
          <Boton key={p} valor={p} actual={filtro.prioridadCnie} n={contadores.prioridadCnie[p] ?? 0} alElegir={set('prioridadCnie')}>{p.toLowerCase()}</Boton>
        ))}
      </div>
      <div className="c-grupo-filtro" role="group" aria-label="Tiempo de espera">
        <span className="c-grupo-titulo" title={`Verde: menos del ${pct(umbrales.amarillo)} de la meta de llegada. Amarillo: del ${pct(umbrales.amarillo)} al ${pct(umbrales.rojo)}. Rojo: más del ${pct(umbrales.rojo)}.`}>Espera</span>
        {(['verde', 'amarillo', 'rojo'] as ColorSemaforo[]).map((c) => (
          <Boton key={c} valor={c} actual={filtro.demora} n={contadores.demora[c] ?? 0} alElegir={set('demora')}><span className={`c-sem c-sem-${c}`} aria-hidden="true" />{ETIQUETA_SEMAFORO[c]}</Boton>
        ))}
      </div>
      <div className="c-grupo-filtro c-grupo-select">
        {supervision && (
          <label className="c-campo-linea">Municipio
            <select value={filtro.municipio ?? ''} onChange={(e) => set('municipio')(e.target.value || null)} data-testid="filtro-municipio">
              <option value="">{`Todos (${contadores.municipio['*'] ?? 0})`}</option>
              {MUNICIPIOS_QRO.map((m) => <option key={m.clave} value={m.clave}>{`${m.clave} · ${m.nombre} (${contadores.municipio[m.clave] ?? 0})`}</option>)}
              <option value="000">{`Fuera de Querétaro (${contadores.municipio['000'] ?? 0})`}</option>
            </select>
          </label>
        )}
        <label className="c-campo-linea">Ordenar
          <select value={orden} onChange={(e) => alOrden(e.target.value as OrdenBandeja)} data-testid="orden-bandeja">
            {ORDENES_BANDEJA.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </label>
        {hayFiltros && <button type="button" className="c-enlace" onClick={() => alCambiar(FILTRO_INICIAL)}>Quitar filtros</button>}
      </div>
    </div>
  );
}

/** Punto de prioridad: color + etiqueta (alta / media / baja). */
export function PuntoPrioridad({ p, cnie }: { p: Reporte['prioridad']; cnie?: string | null }) {
  return (
    <span className={`c-prio-chip c-prio-${p}`} data-testid="punto-prioridad" data-prioridad={p} title={`Prioridad operativa ${p}${cnie ? ` · CNIE ${cnie}` : ''}`}>
      <span className={`c-prio c-prio-${p}`} aria-hidden="true" />{p}
    </span>
  );
}

/** Semáforo por demora: tiempo de espera contra la meta de llegada. */
export function Semaforo({ s }: { s: Semaforo }) {
  return (
    <span className={`c-sem-chip c-sem-chip-${s.color}`} data-testid="semaforo" data-color={s.color} title={`${ETIQUETA_SEMAFORO[s.color]}: ${Math.round(s.fraccion * 100)} % de la meta de llegada${s.corriendo ? '' : ' (ya llegó la unidad o terminó)'}`}>
      <span className={`c-sem c-sem-${s.color}`} aria-hidden="true" />
      {`${duracionTexto(s.segundos)} / ${Math.round(s.metaSegundos / 60)} min`}
      <span className="solo-lector">{` · ${ETIQUETA_SEMAFORO[s.color]}`}</span>
    </span>
  );
}

export const semaforoReporte = (r: Reporte, ahora: number, u: UmbralesSemaforo) => semaforoDe(r, ahora, u);

/** Umbrales del semáforo. En la demo los cambia supervisión; en el API se configuran en el servidor. */
export function UmbralesSemaforoForm({ actuales, alGuardar }: { actuales: UmbralesSemaforo; alGuardar: (u: UmbralesSemaforo) => Promise<string | null> }) {
  const [amarillo, setAmarillo] = useState(String(Math.round(actuales.amarillo * 100)));
  const [rojo, setRojo] = useState(String(Math.round(actuales.rojo * 100)));
  const [msj, setMsj] = useState('');
  const u = { amarillo: Number(amarillo) / 100, rojo: Number(rojo) / 100 };
  const error = validarUmbrales(u);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (error) return;
    const x = await alGuardar(u);
    setMsj(x ?? 'Guardado.');
  }
  return (
    <details className="c-umbrales" data-testid="umbrales">
      <summary>{`Semáforo: amarillo desde ${Math.round(actuales.amarillo * 100)} %, rojo arriba de ${Math.round(actuales.rojo * 100)} % de la meta de llegada`}</summary>
      {DEMO ? (
        <form className="c-form" onSubmit={guardar}>
          <label className="c-campo-linea">Amarillo desde<input type="number" min={1} max={999} value={amarillo} onChange={(e) => { setAmarillo(e.target.value); setMsj(''); }} aria-label="Umbral amarillo en por ciento" />%</label>
          <label className="c-campo-linea">Rojo arriba de<input type="number" min={2} max={1000} value={rojo} onChange={(e) => { setRojo(e.target.value); setMsj(''); }} aria-label="Umbral rojo en por ciento" />%</label>
          <button className="c-boton-sec" disabled={!!error}>Guardar</button>
          <button type="button" className="c-enlace" onClick={() => { setAmarillo(String(UMBRALES_SEMAFORO_PREDETERMINADOS.amarillo * 100)); setRojo(String(UMBRALES_SEMAFORO_PREDETERMINADOS.rojo * 100)); }}>Valores pedidos (50 % / 100 %)</button>
          {(error || msj) && <span className={error ? 'c-error' : 'suave c-pequeno'} role="status">{error ?? msj}</span>}
        </form>
      ) : <p className="suave c-pequeno">Se configuran en el servidor con SEMAFORO_AMARILLO y SEMAFORO_ROJO (fracción de la meta, por ejemplo 0.5 y 1).</p>}
    </details>
  );
}

/**
 * Recatalogar a «Mal Uso del servicio (Improcedentes)», tipo 7 del CNIE. Solo el operador, después de
 * verificar el reporte; el motivo es obligatorio y queda en el historial con el tipo original.
 */
export function RecatalogarMalUso({ r, ocupado, hacer }: { r: Reporte; ocupado: boolean; hacer: (a: Accion, despues?: () => void) => Promise<void> }) {
  const [codigo, setCodigo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [intento, setIntento] = useState(false);
  const yaMalUso = esMalUso(r.cnie?.tipo.codigo);
  const recatalogaciones = r.correccionesCnie.filter((c) => c.malUso);
  const faltaMotivo = motivo.trim().length < 3;
  if (!r.operable && !recatalogaciones.length) return null;
  return (
    <div className={`c-tarjeta c-mal-uso ${yaMalUso ? 'aplicado' : ''}`} data-testid="mal-uso">
      <div className="c-fila">
        <h3>Mal Uso del servicio</h3>
        {yaMalUso && <span className="c-chip c-chip-alerta" data-testid="mal-uso-aplicado">Improcedente · tipo 7</span>}
      </div>
      {recatalogaciones.length > 0 && (
        <ul className="c-lista c-pequeno" data-testid="mal-uso-historial">
          {recatalogaciones.map((x) => (
            <li key={x.en}>{`${hora(x.en)} · ${x.actor.replace(/^operador:/, '')} · tipo original ${x.tipoDe ? `${x.tipoDe} ${tipoCnie(x.tipoDe)?.nombre ?? ''}` : 'sin clasificar'} (${x.de ?? '—'}) → tipo ${x.tipoA} (${x.a}) · motivo: “${x.motivo}”`}</li>
          ))}
        </ul>
      )}
      {r.operable && !yaMalUso && (
        <details className="c-reasignar">
          <summary>Recatalogar a Mal Uso del servicio (Improcedentes)</summary>
          <p className="suave c-pequeno">{'Solo después de verificar que el reporte es falso, una broma o un mal uso del servicio. El folio conserva su tipo original en el historial y cuenta como improcedente en el reporte por municipio y en el SESNSP.'}</p>
          <form className="c-form c-form-columna" onSubmit={(e) => {
            e.preventDefault(); setIntento(true);
            if (!codigo || faltaMotivo) return;
            void hacer({ accion: 'recatalogar_mal_uso', codigoCnie: codigo, motivo: motivo.trim() }, () => { setCodigo(''); setMotivo(''); setIntento(false); });
          }}>
            <label className="c-campo">Incidente de Mal Uso
              <select value={codigo} onChange={(e) => setCodigo(e.target.value)} data-testid="mal-uso-codigo" required>
                <option value="">Elige…</option>
                {INCIDENTES_MAL_USO.map((i) => <option key={i.codigo} value={i.codigo}>{`${i.codigo} · ${nombreLegible(i.nombre)}`}</option>)}
              </select>
            </label>
            <label className="c-campo">Motivo (obligatorio)
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ej. Se devolvió la llamada: niño jugando, sin emergencia" data-testid="mal-uso-motivo" aria-invalid={intento && faltaMotivo} />
            </label>
            {intento && (!codigo || faltaMotivo) && <p className="c-error" role="alert">{!codigo ? 'Elige el incidente de Mal Uso.' : 'Escribe el motivo: es obligatorio y queda en el historial.'}</p>}
            <button className="c-boton-sec c-peligro" disabled={ocupado} data-testid="mal-uso-guardar">Recatalogar</button>
          </form>
        </details>
      )}
    </div>
  );
}
