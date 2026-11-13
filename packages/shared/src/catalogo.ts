/**
 * Catálogo de incidentes que ve el ciudadano.
 *
 * Cada entrada es una opción en lenguaje simple que se mapea a un código del
 * Catálogo Nacional de Incidentes de Emergencia (CNIE) del SESNSP.
 *
 * IMPORTANTE: `codigoCnie` queda en `null` a propósito. Debe llenarse con la
 * versión oficial vigente del CNIE antes del piloto; NO inventar códigos. En
 * producción el catálogo vive en base de datos y se versiona; este archivo es
 * solo la semilla de desarrollo.
 */
export type Prioridad = 'alta' | 'media' | 'baja';
export type Corporacion = 'policia_municipal' | 'policia_estatal' | 'cruz_roja' | 'bomberos' | 'proteccion_civil';

export interface IncidenteCatalogo {
  id: string;
  categoria: 'seguridad' | 'medico' | 'proteccion_civil' | 'servicios_publicos';
  nombreCiudadano: string;
  codigoCnie: string | null;
  prioridad: Prioridad;
  corporacionSugerida: Corporacion;
  preguntasGuia: { id: string; texto: string; tipo: 'si_no' | 'numero' | 'texto' }[];
}

const P_HERIDOS = { id: 'heridos', texto: '¿Hay personas heridas?', tipo: 'si_no' } as const;
const P_ARMAS = { id: 'armas', texto: '¿Viste armas?', tipo: 'si_no' } as const;
const P_PERSONAS = { id: 'personas', texto: '¿Cuántas personas involucradas?', tipo: 'numero' } as const;

export const CATALOGO_SEMILLA: readonly IncidenteCatalogo[] = [
  { id: 'robo-en-curso', categoria: 'seguridad', nombreCiudadano: 'Me están robando / robo en curso', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_ARMAS, P_HERIDOS, P_PERSONAS] },
  { id: 'agresion', categoria: 'seguridad', nombreCiudadano: 'Agresión o pelea', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_ARMAS, P_HERIDOS, P_PERSONAS] },
  { id: 'violencia-familiar', categoria: 'seguridad', nombreCiudadano: 'Violencia familiar o de pareja', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_HERIDOS, P_ARMAS] },
  { id: 'disparos', categoria: 'seguridad', nombreCiudadano: 'Disparos', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_HERIDOS] },
  { id: 'persona-sospechosa', categoria: 'seguridad', nombreCiudadano: 'Persona o vehículo sospechoso', codigoCnie: null, prioridad: 'media', corporacionSugerida: 'policia_municipal', preguntasGuia: [P_PERSONAS] },
  { id: 'accidente-vial', categoria: 'medico', nombreCiudadano: 'Accidente de tránsito', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'cruz_roja', preguntasGuia: [P_HERIDOS, P_PERSONAS] },
  { id: 'persona-lesionada', categoria: 'medico', nombreCiudadano: 'Persona herida o inconsciente', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'cruz_roja', preguntasGuia: [P_PERSONAS] },
  { id: 'incendio', categoria: 'proteccion_civil', nombreCiudadano: 'Incendio', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'bomberos', preguntasGuia: [P_HERIDOS] },
  { id: 'fuga-gas', categoria: 'proteccion_civil', nombreCiudadano: 'Fuga de gas', codigoCnie: null, prioridad: 'alta', corporacionSugerida: 'bomberos', preguntasGuia: [] },
  { id: 'inundacion', categoria: 'proteccion_civil', nombreCiudadano: 'Inundación', codigoCnie: null, prioridad: 'media', corporacionSugerida: 'proteccion_civil', preguntasGuia: [P_PERSONAS] },
  { id: 'ruido-rina', categoria: 'servicios_publicos', nombreCiudadano: 'Ruido excesivo o fiesta', codigoCnie: null, prioridad: 'baja', corporacionSugerida: 'policia_municipal', preguntasGuia: [] },
  { id: 'otro', categoria: 'seguridad', nombreCiudadano: 'Otra emergencia', codigoCnie: null, prioridad: 'media', corporacionSugerida: 'policia_municipal', preguntasGuia: [] },
];

export function incidentePorId(id: string): IncidenteCatalogo | undefined {
  return CATALOGO_SEMILLA.find((i) => i.id === id);
}
