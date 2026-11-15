/**
 * Catálogo de incidentes que ve el ciudadano.
 *
 * Cada entrada es una opción en lenguaje simple que se mapea al Catálogo
 * Nacional de Incidentes de Emergencia (CNIE) V 3.0 del SESNSP (ver cnie.ts y
 * docs/cnie/README.md). Algunas opciones no tienen un solo código: el código
 * se afina con una respuesta del ciudadano (ver cnie-mapeo.ts) o lo asigna el
 * operador. En producción el catálogo vive en base de datos y se versiona;
 * este archivo es la semilla.
 *
 * Las preguntas que hace la despachadora 911 virtual viven en el protocolo
 * versionado (ver protocolos.ts). `preguntasGuia` queda solo por compatibilidad.
 */
import { incidenteCnie, subtipoCnie, tipoCnie, type CodigoNombre, type PrioridadCnie } from './cnie';

export type Prioridad = 'alta' | 'media' | 'baja';
export type CategoriaIncidente = 'seguridad' | 'medico' | 'proteccion_civil' | 'asistencia';
export type Corporacion = 'policia_municipal' | 'policia_estatal' | 'cruz_roja' | 'bomberos' | 'proteccion_civil';

export interface IncidenteCatalogo {
  id: string;
  /** Alineada con los tipos 1, 2, 3 y 5 del CNIE. */
  categoria: CategoriaIncidente;
  /** Nombre corto: el mismo en el botón de la app ciudadana, en la consola y en el CAD. */
  nombreCorto: string;
  /** Descripción más larga para listas y la despachadora virtual. */
  nombreCiudadano: string;
  /** Tipo CNIE (1 dígito). `null` solo en "Otra emergencia", que clasifica el operador. */
  codigoCnieTipo: CodigoNombre | null;
  /** Subtipo CNIE (3 dígitos). */
  codigoCnieSubtipo: CodigoNombre | null;
  /** Incidente CNIE (5 dígitos). `null` cuando se afina con una respuesta o lo asigna el operador. */
  codigoCnie: CodigoNombre | null;
  /** Prioridad que da el CNIE al incidente. Puede diferir de `prioridad`, que es la operativa de POL-IAQ. */
  prioridadCnie: PrioridadCnie | null;
  /** Segundo código que se registra junto al principal cuando aplica (por ejemplo, lesionados en una agresión). */
  codigoCnieSecundario?: CodigoNombre;
  prioridad: Prioridad;
  corporacionSugerida: Corporacion;
  preguntasGuia: { id: string; texto: string; tipo: 'si_no' | 'numero' | 'texto' }[];
}

const P_HERIDOS = { id: 'heridos', texto: '¿Hay personas heridas?', tipo: 'si_no' } as const;
const P_ARMAS = { id: 'armas', texto: '¿Viste armas?', tipo: 'si_no' } as const;
const P_PERSONAS = { id: 'personas', texto: '¿Cuántas personas involucradas?', tipo: 'numero' } as const;

/** Tipo, subtipo e incidente CNIE comprobados contra el catálogo cargado (falla al arrancar si no existen). */
function cnie(subtipo: string, incidente: string | null) {
  const s = subtipoCnie(subtipo);
  if (!s) throw new Error(`Subtipo CNIE no vigente: ${subtipo}`);
  const t = tipoCnie(s.tipo)!;
  const i = incidente ? incidenteCnie(incidente) : undefined;
  if (incidente && (!i || i.subtipo.codigo !== subtipo)) throw new Error(`Incidente CNIE ${incidente} no vigente o fuera del subtipo ${subtipo}`);
  return {
    codigoCnieTipo: { codigo: t.codigo, nombre: t.nombre },
    codigoCnieSubtipo: { codigo: s.codigo, nombre: s.nombre },
    codigoCnie: i ? { codigo: i.codigo, nombre: i.nombre } : null,
    prioridadCnie: i?.prioridad ?? null,
  };
}
const SIN_CNIE = { codigoCnieTipo: null, codigoCnieSubtipo: null, codigoCnie: null, prioridadCnie: null };

export const CATALOGO_SEMILLA: readonly IncidenteCatalogo[] = [
  { id: 'robo-en-curso', categoria: 'seguridad', nombreCorto: 'Me están robando', nombreCiudadano: 'Me están robando / robo en curso', ...cnie('304', null), prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_ARMAS, P_HERIDOS, P_PERSONAS] },
  { id: 'agresion', categoria: 'seguridad', nombreCorto: 'Agresión o pelea', nombreCiudadano: 'Agresión o pelea', ...cnie('309', '30909'), prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_ARMAS, P_HERIDOS, P_PERSONAS] },
  { id: 'intrusion-domicilio', categoria: 'seguridad', nombreCorto: 'Alguien quiere entrar', nombreCiudadano: 'Ruidos extraños o alguien intenta entrar a mi casa', ...cnie('310', '31001'), prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_ARMAS, P_PERSONAS] },
  { id: 'violencia-familiar', categoria: 'seguridad', nombreCorto: 'Violencia familiar', nombreCiudadano: 'Violencia familiar o de pareja', ...cnie('305', '30503'), prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_HERIDOS, P_ARMAS] },
  { id: 'disparos', categoria: 'seguridad', nombreCorto: 'Disparos', nombreCiudadano: 'Disparos', ...cnie('302', '30202'), prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_HERIDOS] },
  { id: 'persona-sospechosa', categoria: 'seguridad', nombreCorto: 'Algo sospechoso', nombreCiudadano: 'Persona o vehículo sospechoso', ...cnie('309', '30904'), prioridad: 'media', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_PERSONAS] },
  { id: 'accidente-vial', categoria: 'medico', nombreCorto: 'Accidente de tránsito', nombreCiudadano: 'Accidente de tránsito', ...cnie('101', null), prioridad: 'alta', corporacionSugerida: 'cruz_roja', preguntasGuia: [P_HERIDOS, P_PERSONAS] },
  { id: 'emergencia-medica', categoria: 'medico', nombreCorto: 'Emergencia médica', nombreCiudadano: 'Emergencia médica (desmayo, dolor de pecho, caída)', ...cnie('103', null), prioridad: 'alta', corporacionSugerida: 'cruz_roja', preguntasGuia: [] },
  { id: 'persona-lesionada', categoria: 'medico', nombreCorto: 'Persona herida', nombreCiudadano: 'Persona herida o inconsciente', ...cnie('102', null), prioridad: 'alta', corporacionSugerida: 'cruz_roja', preguntasGuia: [P_PERSONAS] },
  { id: 'incendio', categoria: 'proteccion_civil', nombreCorto: 'Incendio', nombreCiudadano: 'Incendio', ...cnie('203', null), prioridad: 'alta', corporacionSugerida: 'bomberos', preguntasGuia: [P_HERIDOS] },
  { id: 'fuga-gas', categoria: 'proteccion_civil', nombreCorto: 'Fuga de gas', nombreCiudadano: 'Fuga de gas', ...cnie('201', '20115'), prioridad: 'alta', corporacionSugerida: 'bomberos', preguntasGuia: [] },
  { id: 'inundacion', categoria: 'proteccion_civil', nombreCorto: 'Inundación', nombreCiudadano: 'Inundación', ...cnie('202', '20207'), prioridad: 'media', corporacionSugerida: 'proteccion_civil', preguntasGuia: [P_PERSONAS] },
  { id: 'ruido-rina', categoria: 'asistencia', nombreCorto: 'Ruido o fiesta', nombreCiudadano: 'Ruido excesivo o fiesta', ...cnie('501', '50105'), prioridad: 'baja', corporacionSugerida: 'policia_municipal', preguntasGuia: [] },
  { id: 'otro', categoria: 'seguridad', nombreCorto: 'Otra emergencia', nombreCiudadano: 'Otra emergencia', ...SIN_CNIE, prioridad: 'media', corporacionSugerida: 'policia_municipal', preguntasGuia: [] },
];

export function incidentePorId(id: string): IncidenteCatalogo | undefined {
  return CATALOGO_SEMILLA.find((i) => i.id === id);
}
