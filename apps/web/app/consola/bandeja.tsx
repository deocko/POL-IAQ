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

export function FiltrosBandeja({ filtro, alCambiar, orden, alOrden, contadores, supervision, umbrales, sinQuitar = false }: {
  filtro: FiltroVista; alCambiar: (f: FiltroVista) => void; orden: OrdenBandeja; alOrden: (o: OrdenBandeja) => void; contadores: Contadores; supervision: boolean; umbrales: UmbralesSemaforo;
  /** En el panel de móvil «Limpiar» ya quita los filtros. */
  sinQuitar?: boolean;
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
        {hayFiltros && !sinQuitar && <button type="button" className="c-enlace" onClick={() => alCambiar(FILTRO_INICIAL)}>Quitar filtros</button>}
      </div>
    </div>
  );
}

/** Punto de prioridad: color + etiqueta (alta / media / baja). */
/** Móvil: filtros activos como chips removibles arriba de la lista (cada «×» quita solo ese filtro). */
export function ChipsFiltrosActivos({ filtro, alCambiar }: { filtro: FiltroVista; alCambiar: (f: FiltroVista) => void }) {
  const chips: { clave: keyof FiltroVista; texto: string }[] = [];
  if (filtro.estado !== 'activos') chips.push({ clave: 'estado', texto: `Estado: ${filtro.estado === 'todos' ? 'Todos' : GRUPOS_ESTADO.find((g) => g.id === filtro.estado)?.nombre ?? filtro.estado}` });
  if (filtro.prioridad) chips.push({ clave: 'prioridad', texto: `Prioridad: ${filtro.prioridad}` });
  if (filtro.prioridadCnie) chips.push({ clave: 'prioridadCnie', texto: `CNIE: ${filtro.prioridadCnie.toLowerCase()}` });
  if (filtro.demora) chips.push({ clave: 'demora', texto: `Espera: ${ETIQUETA_SEMAFORO[filtro.demora]}` });
  if (filtro.municipio) chips.push({ clave: 'municipio', texto: filtro.municipio === '000' ? 'Fuera de Querétaro' : `Municipio: ${MUNICIPIOS_QRO.find((m) => m.clave === filtro.municipio)?.nombre ?? filtro.municipio}` });
  if (!chips.length) return null;
  return (
    <ul className="c-chips-activos" aria-label="Filtros activos" data-testid="chips-filtros">
      {chips.map((c) => (
        <li key={c.clave}>
          <button type="button" className="c-chip-quitar" aria-label={`Quitar filtro ${c.texto}`} onClick={() => alCambiar({ ...filtro, [c.clave]: c.clave === 'estado' ? 'activos' : null })}>
            {c.texto}<span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

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

/**
 * Panel de la derecha cuando no hay reporte elegido: resumen útil de la bandeja (conteos por estado y
 * por prioridad, el pendiente más antiguo con su semáforo y el botón para iniciar un reporte), para que
 * ningún tamaño de pantalla muestre un área vacía. Cada conteo aplica su filtro.
 */
export function ResumenBandeja({ reportes, contadores, ahora, umbrales, alFiltrar, alAbrir, alIniciar }: {
  reportes: Reporte[]; contadores: Contadores; ahora: number; umbrales: UmbralesSemaforo;
  alFiltrar: (f: FiltroVista) => void; alAbrir: (folio: string) => void; alIniciar: () => void;
}) {
  const activos = reportes.filter((r) => grupoEstado(r.estado) !== 'atendidos');
  const porPrioridad: Record<string, number> = { alta: 0, media: 0, baja: 0 };
  const porEspera: Record<ColorSemaforo, number> = { verde: 0, amarillo: 0, rojo: 0 };
  for (const r of activos) { porPrioridad[r.prioridad] = (porPrioridad[r.prioridad] ?? 0) + 1; porEspera[semaforoDe(r, ahora, umbrales).color]++; }
  const masAntiguo = [...activos].sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn))[0];
  const Conteo = ({ n, texto, filtro, clase = '' }: { n: number; texto: string; filtro: FiltroVista; clase?: string }) => (
    <button type="button" className={`c-resumen-conteo ${clase}`} onClick={() => alFiltrar(filtro)} data-testid={`resumen-${texto.toLowerCase()}`}>
      <strong>{n}</strong><span>{texto}</span>
    </button>
  );
  return (
    <section className="c-detalle c-resumen" aria-label="Resumen de la bandeja" data-testid="resumen-bandeja">
      <div className="c-fila">
        <h2>Resumen de la bandeja</h2>
        <button type="button" className="c-boton" onClick={alIniciar} data-testid="resumen-iniciar">Iniciar nuevo reporte</button>
      </div>
      <p className="suave c-pequeno">Elige un reporte de la lista para ver el cuestionario de la despachadora virtual y despachar. Toca un conteo para filtrar la bandeja.</p>
      <div className="c-tarjeta">
        <h3>Por estado</h3>
        <div className="c-resumen-conteos">
          <Conteo n={contadores.estado.nuevos} texto="Nuevos" filtro={{ ...FILTRO_INICIAL, estado: 'nuevos' }} clase={contadores.estado.nuevos ? 'alerta' : ''} />
          <Conteo n={contadores.estado.pendientes} texto="Pendientes" filtro={{ ...FILTRO_INICIAL, estado: 'pendientes' }} />
          <Conteo n={contadores.estado.atendidos} texto="Atendidos" filtro={{ ...FILTRO_INICIAL, estado: 'atendidos' }} />
        </div>
      </div>
      <div className="c-rejilla c-resumen-rejilla">
        <div className="c-tarjeta">
          <h3>Activos por prioridad</h3>
          <div className="c-resumen-conteos">
            {(['alta', 'media', 'baja'] as const).map((p) => (
              <Conteo key={p} n={porPrioridad[p] ?? 0} texto={p[0].toUpperCase() + p.slice(1)} filtro={{ ...FILTRO_INICIAL, prioridad: p }} clase={`c-prio-borde-${p}`} />
            ))}
          </div>
        </div>
        <div className="c-tarjeta">
          <h3>Activos por espera</h3>
          <div className="c-resumen-conteos">
            {(['verde', 'amarillo', 'rojo'] as ColorSemaforo[]).map((c) => (
              <Conteo key={c} n={porEspera[c]} texto={ETIQUETA_SEMAFORO[c]} filtro={{ ...FILTRO_INICIAL, demora: c }} clase={`c-sem-borde-${c}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="c-tarjeta" data-testid="resumen-mas-antiguo">
        <h3>Pendiente más antiguo</h3>
        {masAntiguo ? (
          <button type="button" className={`c-item p-${masAntiguo.prioridad}`} onClick={() => alAbrir(masAntiguo.folio)}>
            <div className="c-fila">
              <span className="c-linea"><PuntoPrioridad p={masAntiguo.prioridad} cnie={masAntiguo.cnie?.prioridad} /><strong>{masAntiguo.incidente}</strong></span>
              <Semaforo s={semaforoDe(masAntiguo, ahora, umbrales)} />
            </div>
            <div className="suave c-pequeno">{`${masAntiguo.folio}${masAntiguo.municipioClave ? ` · municipio ${masAntiguo.municipioClave}` : ''} · creado a las ${hora(masAntiguo.creadoEn)} · abrir`}</div>
          </button>
        ) : <p className="suave">{'Sin reportes activos: todo está atendido.'}</p>}
      </div>
    </section>
  );
}
