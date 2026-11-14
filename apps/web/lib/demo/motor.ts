/**
 * Motor de la demo pública (GitHub Pages).
 *
 * En la demo no hay servidor: este módulo hace en el navegador lo que hacen el
 * API (services/api) y el CAD simulado (services/cad-simulator), con la misma
 * lógica del paquete compartido: folio unificado, enrutamiento por geocerca,
 * máquina de estados, cuestionario de la despachadora y canalización.
 *
 * Los datos viven en el localStorage de quien abre la demo y se comparten entre
 * pestañas del mismo navegador (BroadcastChannel). Son SOLO de demostración:
 * nada sale del navegador ni llega a un CAD real.
 */
import {
  CAD_ESTATAL_ID, CATALOGO_SEMILLA, ESTADOS, ESTADOS_FINALES, ETIQUETAS_CIUDADANO, MUNICIPIOS_PILOTO, PROTOCOLO_PROVISIONAL,
  aplica, canalizar, enrutarPorUbicacion, generarFolio, incidentePorId, preguntasPara as preguntasProtocolo, preguntasPendientes, protocoloDe,
  puedeTransicionar, resolverEntradas, respuestasDe, transcripcion,
  type Canalizacion, type Cuestionario, type EntradaCuestionario, type EstadoIncidente, type PreguntaProtocolo, type ValorRespuesta,
} from '@pol-iaq/shared/movil';

export const PROTOCOLO = PROTOCOLO_PROVISIONAL;
/** Segundos sin acuse antes de escalar al C5 (en producción son 30 s; en la demo hay más margen). */
export const ESPERA_ACUSE_SEG = 90;
/** Credenciales de la consola en la demo. */
export const OPERADOR_DEMO = { usuario: 'operador', clave: 'operador', nombre: 'Operador de demostración' };
const TOKEN_DEMO = 'demo-operador';
const CLAVE = 'poliaq.demo.v1';
const CANAL = 'poliaq-demo';

export const CADS_DEMO = [
  ...MUNICIPIOS_PILOTO.map((m) => ({ id: m.cadId, nombre: `CAD ${m.nombre}` })),
  { id: CAD_ESTATAL_ID, nombre: 'C5 Querétaro (estatal)' },
];

/** Unidades ficticias (las mismas de ejemplo del API en desarrollo). */
export const UNIDADES_DEMO = CADS_DEMO.flatMap((c, i) => [
  { unidadId: `P-${i + 1}01`, cadId: c.id, corporacion: c.id === CAD_ESTATAL_ID ? 'policia_estatal' : 'policia_municipal', etiqueta: `Patrulla ${i + 1}01` },
  { unidadId: `P-${i + 1}02`, cadId: c.id, corporacion: c.id === CAD_ESTATAL_ID ? 'policia_estatal' : 'policia_municipal', etiqueta: `Patrulla ${i + 1}02` },
  { unidadId: `A-${i + 1}10`, cadId: c.id, corporacion: 'cruz_roja', etiqueta: `Ambulancia ${i + 1}10` },
  { unidadId: `B-${i + 1}20`, cadId: c.id, corporacion: 'bomberos', etiqueta: `Unidad de bomberos ${i + 1}20` },
]);

/** Lugares de prueba: uno por municipio piloto y uno fuera (va al C5). */
export const LUGARES_DEMO = [
  { id: 'qro', nombre: 'Centro de Querétaro', lat: 20.5888, lng: -100.3899, referencia: 'Jardín Zenea (ubicación de prueba)' },
  { id: 'corr', nombre: 'El Pueblito, Corregidora', lat: 20.539, lng: -100.442, referencia: 'Plaza principal (ubicación de prueba)' },
  { id: 'marq', nombre: 'La Cañada, El Marqués', lat: 20.61, lng: -100.32, referencia: 'Jardín principal (ubicación de prueba)' },
  { id: 'sjr', nombre: 'San Juan del Río (fuera del piloto)', lat: 20.389, lng: -99.996, referencia: 'Centro (ubicación de prueba)' },
];

export interface Unidad { unidadId: string; corporacion: string; etiqueta: string; etaMinutos?: number; lat?: number; lng?: number }
export interface Mensaje { id: string; autor: 'ciudadano' | 'operador' | 'unidad'; nombreAutor?: string; texto: string; en: string }

export interface ReporteDemo {
  folio: string;
  folioCad: string | null;
  cadId: string;
  municipioClave: string | null;
  incidenteId: string;
  prioridad: Canalizacion['prioridad'];
  estado: EstadoIncidente;
  asistenciaDirecta: boolean;
  ubicacion: { lat: number; lng: number; precisionMetros?: number; referencia?: string };
  descripcion: string | null;
  reportante: { nombre: string; telefono: string; confiabilidad: number };
  cuestionario: Cuestionario;
  canalizacion: Canalizacion;
  unidad: Unidad | null;
  mensajes: Mensaje[];
  historial: { estado: EstadoIncidente; en: string; nota?: string }[];
  creadoEn: string;
  actualizadoEn: string;
  /** Si el CAD simulado lo despacha solo (en lugar de la consola). */
  cadSimulado: { inicio: number; paso: number } | null;
}

interface Estado { version: 1; consecutivos: Record<string, number>; reportes: ReporteDemo[] }

// ---------------------------------------------------------------------------
// Almacén local y avisos entre pestañas
// ---------------------------------------------------------------------------

let memoria: Estado = { version: 1, consecutivos: {}, reportes: [] };
const oyentes = new Set<(folios: string[]) => void>();
let canal: BroadcastChannel | null = null;

function leer(): Estado {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t) memoria = JSON.parse(t) as Estado;
  } catch { /* sin almacenamiento: queda en memoria */ }
  return memoria;
}

function escribir(e: Estado, folios: string[]) {
  memoria = e;
  try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* sin almacenamiento */ }
  oyentes.forEach((f) => f(folios));
  try { canal?.postMessage(folios); } catch { /* canal cerrado */ }
}

/** Lee, cambia y guarda en un solo paso síncrono. */
function cambiar<T>(f: (e: Estado) => { resultado: T; folios: string[] }): T {
  const e = leer();
  const { resultado, folios } = f(e);
  if (folios.length) escribir(e, folios);
  return resultado;
}

let arrancado = false;
/** Activa el aviso entre pestañas y el reloj (acuse al C5 y CAD simulado). */
export function arrancar() {
  if (arrancado || typeof window === 'undefined') return;
  arrancado = true;
  try {
    canal = new BroadcastChannel(CANAL);
    canal.onmessage = (m) => { leer(); oyentes.forEach((f) => f(m.data as string[])); };
  } catch { canal = null; }
  window.addEventListener('storage', (ev) => { if (ev.key === CLAVE) { leer(); oyentes.forEach((f) => f([])); } });
  setInterval(tic, 1000);
}

export function escuchar(f: (folios: string[]) => void) {
  arrancar();
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

export function borrarTodo() {
  escribir({ version: 1, consecutivos: {}, reportes: [] }, ['*']);
}

// ---------------------------------------------------------------------------
// Errores con los mismos códigos que el API
// ---------------------------------------------------------------------------

export class ErrorDemo extends Error {
  constructor(readonly status: number, readonly codigo: string) { super(codigo); }
}

const ahoraIso = () => new Date().toISOString();
const id = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function transicionar(r: ReporteDemo, estado: EstadoIncidente, nota?: string) {
  if (r.estado === estado) return;
  if (!puedeTransicionar(r.estado, estado)) throw new ErrorDemo(409, 'transicion_invalida');
  r.estado = estado;
  r.historial.push({ estado, en: ahoraIso(), ...(nota && { nota }) });
}

// ---------------------------------------------------------------------------
// Lado ciudadano (lo que hace /v1/reportes)
// ---------------------------------------------------------------------------

export const CATALOGO = CATALOGO_SEMILLA;

/**
 * Preguntas del formulario: las obligatorias del protocolo que aplican con lo ya
 * contestado (las condicionales aparecen al contestar la que las activa).
 */
export function preguntasPara(incidenteId: string, respuestas: Record<string, ValorRespuesta> = {}): PreguntaProtocolo[] {
  return preguntasProtocolo(PROTOCOLO, incidenteId).filter((q) => q.obligatoria && aplica(q, respuestas));
}

export function recomendacionesPara(incidenteId: string): string[] {
  return protocoloDe(PROTOCOLO, incidenteId)?.recomendaciones ?? [];
}

export interface NuevoReporte {
  incidenteId: string;
  lugarId: string;
  descripcion?: string;
  respuestas: EntradaCuestionario[];
  nombre: string;
  telefono: string;
  asistenciaDirecta?: boolean;
  /** true: el CAD simulado lo despacha solo; false: lo despacha quien use la consola. */
  cadSimulado: boolean;
}

export function crearReporte(d: NuevoReporte): ReporteDemo {
  const incidente = incidentePorId(d.incidenteId);
  const lugar = LUGARES_DEMO.find((l) => l.id === d.lugarId);
  if (!incidente || !lugar) throw new ErrorDemo(400, 'datos_invalidos');
  return cambiar((e) => {
    const ruta = enrutarPorUbicacion(lugar.lat, lugar.lng);
    const anio = new Date().getUTCFullYear();
    const clave = ruta.municipio?.claveInegi ?? null;
    const k = `${clave ?? '000'}-${anio}`;
    e.consecutivos[k] = (e.consecutivos[k] ?? 0) + 1;
    const folio = generarFolio(clave, anio, e.consecutivos[k]);
    const iso = ahoraIso();
    const { validas } = resolverEntradas(PROTOCOLO, incidente.id, d.respuestas, 'formulario', iso);
    const canalizacion = canalizar(PROTOCOLO, incidente, respuestasDe(validas), { asistenciaDirecta: d.asistenciaDirecta });
    const r: ReporteDemo = {
      folio,
      folioCad: null,
      cadId: ruta.cadId,
      municipioClave: clave,
      incidenteId: incidente.id,
      prioridad: canalizacion.prioridad,
      estado: 'recibido',
      asistenciaDirecta: !!d.asistenciaDirecta,
      ubicacion: { lat: lugar.lat, lng: lugar.lng, precisionMetros: 12, referencia: lugar.referencia },
      descripcion: d.descripcion?.trim() || null,
      reportante: { nombre: d.nombre.trim() || 'Ciudadano de prueba', telefono: d.telefono, confiabilidad: 1 },
      cuestionario: { protocoloVersion: PROTOCOLO.version, protocoloEstado: PROTOCOLO.estado, entradas: validas },
      canalizacion,
      unidad: null,
      mensajes: [],
      historial: [{ estado: 'recibido', en: iso }],
      creadoEn: iso,
      actualizadoEn: iso,
      cadSimulado: d.cadSimulado ? { inicio: Date.now(), paso: 0 } : null,
    };
    e.reportes.push(r);
    return { resultado: r, folios: [folio] };
  });
}

export function reporte(folio: string): ReporteDemo | undefined {
  return leer().reportes.find((r) => r.folio === folio);
}

export function mensajeCiudadano(folio: string, texto: string) {
  return cambiar((e) => {
    const r = e.reportes.find((x) => x.folio === folio);
    if (!r) throw new ErrorDemo(404, 'folio_no_encontrado');
    if (ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_finalizado');
    r.mensajes.push({ id: id(), autor: 'ciudadano', texto, en: ahoraIso() });
    r.actualizadoEn = ahoraIso();
    return { resultado: r, folios: [folio] };
  });
}

export function cancelar(folio: string) {
  return cambiar((e) => {
    const r = e.reportes.find((x) => x.folio === folio);
    if (!r) throw new ErrorDemo(404, 'folio_no_encontrado');
    if (ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_finalizado');
    transicionar(r, 'cancelado', 'Cancelado por el ciudadano');
    r.cadSimulado = null;
    r.actualizadoEn = ahoraIso();
    return { resultado: r, folios: [folio] };
  });
}

export const etiquetaCiudadano = (e: EstadoIncidente) => ETIQUETAS_CIUDADANO[e];
export const nombreCad = (cadId: string) => CADS_DEMO.find((c) => c.id === cadId)?.nombre ?? cadId;

// ---------------------------------------------------------------------------
// Lado operador (lo que hace /v1/operador)
// ---------------------------------------------------------------------------

export type AccionDemo =
  | { accion: 'recibir' }
  | { accion: 'asignar'; unidadId: string; etaMinutos?: number }
  | { accion: 'estado'; estado: 'en_camino' | 'en_sitio' | 'cerrado' | 'improcedente'; nota?: string }
  | { accion: 'mensaje'; texto: string }
  | { accion: 'transferir'; cadDestinoId: string; motivo?: string };

function yo() {
  return {
    operador: { usuario: OPERADOR_DEMO.usuario, nombre: OPERADOR_DEMO.nombre, cads: ['*'] },
    // En la demo todos los CAD están en modo consola para poder despachar desde aquí.
    cads: CADS_DEMO.map((c) => ({ ...c, modo: 'consola' as const, mio: true })),
    protocolo: { version: PROTOCOLO.version, estado: PROTOCOLO.estado },
  };
}

function exigirToken(token: string | null) {
  if (token !== TOKEN_DEMO) throw new ErrorDemo(401, 'no_autenticado');
}

export function vistaOperador(r: ReporteDemo) {
  const incidente = incidentePorId(r.incidenteId);
  const pendientes = preguntasPendientes(PROTOCOLO, r.incidenteId, respuestasDe(r.cuestionario.entradas));
  const escalaAlC5En = r.estado === 'recibido' && !r.folioCad && r.cadId !== CAD_ESTATAL_ID
    ? new Date(new Date(r.creadoEn).getTime() + ESPERA_ACUSE_SEG * 1000).toISOString()
    : null;
  return {
    folio: r.folio,
    folioCad: r.folioCad,
    cadId: r.cadId,
    incidenteId: r.incidenteId,
    incidente: incidente?.nombreCiudadano ?? r.incidenteId,
    categoria: incidente?.categoria ?? null,
    codigoCnie: incidente?.codigoCnie ?? null,
    prioridad: r.prioridad,
    estado: r.estado,
    asistenciaDirecta: r.asistenciaDirecta,
    escenarioId: null,
    ubicacion: r.ubicacion,
    descripcion: r.descripcion,
    reportante: r.reportante,
    cuestionario: { ...r.cuestionario, transcripcion: transcripcion(r.cuestionario), pendientes: pendientes.map((q) => q.texto) },
    canalizacion: r.canalizacion,
    recomendaciones: recomendacionesPara(r.incidenteId),
    unidad: r.unidad,
    evidencias: [] as { id: string; tipo: string; url: string; sha256: string; expiraEn: string }[],
    mensajes: r.mensajes,
    historial: r.historial,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
    escalaAlC5En,
    operable: true,
    transiciones: ESTADOS.filter((x) => puedeTransicionar(r.estado, x)),
  };
}

export const operador = {
  sesion(usuario: string, clave: string) {
    if (usuario !== OPERADOR_DEMO.usuario || clave !== OPERADOR_DEMO.clave) throw new ErrorDemo(401, 'credenciales_invalidas');
    return { token: TOKEN_DEMO, ...yo() };
  },
  yo(token: string | null) {
    exigirToken(token);
    return yo();
  },
  reportes(token: string | null, todos: boolean) {
    exigirToken(token);
    const lista = leer().reportes.filter((r) => todos || !ESTADOS_FINALES.includes(r.estado));
    return { reportes: lista.map(vistaOperador) };
  },
  unidades(token: string | null) {
    exigirToken(token);
    const ocupadas = new Map(leer().reportes.filter((r) => r.unidad && !ESTADOS_FINALES.includes(r.estado)).map((r) => [r.unidad!.unidadId, r.folio]));
    return { unidades: UNIDADES_DEMO.map((u) => ({ ...u, ocupadaEn: ocupadas.get(u.unidadId) ?? null })) };
  },
  accion(token: string | null, folio: string, a: AccionDemo) {
    exigirToken(token);
    return cambiar((e) => {
      const r = e.reportes.find((x) => x.folio === folio);
      if (!r) throw new ErrorDemo(404, 'folio_no_encontrado');
      if (ESTADOS_FINALES.includes(r.estado)) throw new ErrorDemo(409, 'reporte_cerrado');
      // Si alguien despacha a mano, el CAD simulado deja de mover ese reporte.
      r.cadSimulado = null;
      aplicar(r, a, OPERADOR_DEMO.nombre);
      r.actualizadoEn = ahoraIso();
      return { resultado: vistaOperador(r), folios: [folio] };
    });
  },
};

function aplicar(r: ReporteDemo, a: AccionDemo, autor: string) {
  switch (a.accion) {
    case 'recibir':
      if (r.estado !== 'recibido' && r.estado !== 'transferido') throw new ErrorDemo(409, 'ya_recibido');
      r.folioCad = r.folio;
      transicionar(r, 'validado', 'Recibido por el operador');
      break;
    case 'asignar': {
      const u = UNIDADES_DEMO.find((x) => x.unidadId === a.unidadId && x.cadId === r.cadId);
      if (!u) throw new ErrorDemo(400, 'unidad_desconocida');
      if (r.estado === 'recibido') transicionar(r, 'validado');
      transicionar(r, 'asignado');
      r.unidad = { unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, etaMinutos: a.etaMinutos };
      break;
    }
    case 'estado':
      transicionar(r, a.estado, a.nota);
      if (a.estado === 'en_sitio' && r.unidad) r.unidad.etaMinutos = 0;
      break;
    case 'mensaje':
      r.mensajes.push({ id: id(), autor: 'operador', nombreAutor: autor, texto: a.texto, en: ahoraIso() });
      break;
    case 'transferir':
      if (a.cadDestinoId === r.cadId || !CADS_DEMO.some((c) => c.id === a.cadDestinoId)) throw new ErrorDemo(400, 'cad_destino_invalido');
      transicionar(r, 'transferido', a.motivo ?? `Transferido a ${nombreCad(a.cadDestinoId)}`);
      r.cadId = a.cadDestinoId;
      r.unidad = null;
      r.folioCad = null;
      break;
  }
}

// ---------------------------------------------------------------------------
// Reloj: escalamiento al C5 y CAD simulado
// ---------------------------------------------------------------------------

/** Pasos del CAD simulado, en segundos desde que se creó el reporte (como services/cad-simulator). */
const PASOS_SIMULADOR = [3, 6, 8, 10, 14, 18, 22, 26, 32];

function tic() {
  const ahora = Date.now();
  cambiar((e) => {
    const folios: string[] = [];
    for (const r of e.reportes) {
      if (ESTADOS_FINALES.includes(r.estado)) continue;
      // Sin acuse a tiempo, el reporte pasa al C5 con el mismo folio.
      if (!r.cadSimulado && r.estado === 'recibido' && !r.folioCad && r.cadId !== CAD_ESTATAL_ID
        && ahora - new Date(r.creadoEn).getTime() > ESPERA_ACUSE_SEG * 1000) {
        r.historial.push({ estado: 'recibido', en: ahoraIso(), nota: `${nombreCad(r.cadId)} no acusó en ${ESPERA_ACUSE_SEG} s; se escaló al C5` });
        r.cadId = CAD_ESTATAL_ID;
        r.actualizadoEn = ahoraIso();
        folios.push(r.folio);
        continue;
      }
      if (r.cadSimulado && avanzarSimulador(r, ahora)) {
        r.actualizadoEn = ahoraIso();
        folios.push(r.folio);
      }
    }
    return { resultado: null, folios };
  });
}

function avanzarSimulador(r: ReporteDemo, ahora: number): boolean {
  const sim = r.cadSimulado!;
  let cambio = false;
  while (sim.paso < PASOS_SIMULADOR.length && ahora - sim.inicio >= PASOS_SIMULADOR[sim.paso] * 1000) {
    const paso = sim.paso++;
    cambio = true;
    const cad = nombreCad(r.cadId);
    if (paso === 0) {
      r.folioCad = `${r.cadId.toUpperCase()}-${String(Date.now()).slice(-5)}`;
      transicionar(r, 'validado', `Recibido por ${cad} (CAD simulado)`);
    } else if (paso === 1) {
      const principal = r.canalizacion.corporaciones[0];
      const ocupadas = new Set(memoria.reportes.filter((x) => x.unidad && !ESTADOS_FINALES.includes(x.estado)).map((x) => x.unidad!.unidadId));
      const delCad = UNIDADES_DEMO.filter((u) => u.cadId === r.cadId);
      const u = delCad.find((x) => x.corporacion === principal && !ocupadas.has(x.unidadId)) ?? delCad.find((x) => !ocupadas.has(x.unidadId)) ?? delCad[0];
      transicionar(r, 'asignado');
      r.unidad = { unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, etaMinutos: 6 };
    } else if (paso === 2) {
      r.mensajes.push({ id: id(), autor: 'operador', nombreAutor: `Operador de ${cad} (simulado)`, texto: 'Recibimos tu reporte, una unidad va en camino.', en: ahoraIso() });
    } else if (paso >= 3 && paso <= 6) {
      // La unidad se acerca: 4 posiciones con ETA decreciente.
      if (r.estado === 'asignado') transicionar(r, 'en_camino');
      const faltan = 6 - paso;
      if (r.unidad) Object.assign(r.unidad, { etaMinutos: Math.max(1, faltan + 1), lat: r.ubicacion.lat + 0.003 * (faltan + 1), lng: r.ubicacion.lng + 0.0015 * (faltan + 1) });
    } else if (paso === 7) {
      transicionar(r, 'en_sitio');
      if (r.unidad) Object.assign(r.unidad, { etaMinutos: 0, lat: r.ubicacion.lat, lng: r.ubicacion.lng });
    } else if (paso === 8) {
      transicionar(r, 'cerrado', 'Atendido por la unidad (CAD simulado)');
      r.cadSimulado = null;
      break;
    }
  }
  return cambio;
}
