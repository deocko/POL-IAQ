/**
 * Los 18 municipios de Querétaro (entidad INEGI 22) y el CAD de cada uno.
 *
 * `clave` es la clave de municipio de 5 dígitos del Marco Geoestadístico de INEGI (CVEGEO: 22 =
 * Querétaro + 3 del municipio), verificada contra el servicio de INEGI
 * https://gaia.inegi.org.mx/wscatgeo/v2/mgem/22 (18 registros, 22001 a 22018) el 2026-11-15.
 * Es la que va en `municipioClave` de cada folio, en los reportes y en las exportaciones.
 * `claveFolio` son sus 3 últimos dígitos: el folio conserva su formato (QRO-014-2026-000001).
 *
 * `geocerca` es el polígono de jurisdicción: el área geoestadística municipal de INEGI 2022
 * simplificada (ver `municipios-qro.ts` y docs/municipios). Antes de producción, cada municipio y
 * el C5 deben validar su polígono; se puede reemplazar en el alta del CAD.
 *
 * Cada municipio tiene su `cadId` (`cad-<nombre>`), pero un reporte solo va a ese CAD cuando el
 * municipio está **conectado** (Modo A con su CAD por API, o Modo B con la consola de POL-IAQ).
 * Mientras no lo esté, el reporte va al C5 como hasta ahora.
 */
import { MUNICIPIOS_QRO_INEGI } from './municipios-qro';

export type Coordenada = [lng: number, lat: number];

export interface Municipio {
  /** Clave INEGI de 5 dígitos (22001–22018): la de `municipioClave`. */
  clave: string;
  /** Parte municipal (3 dígitos) de la clave: la que va en el folio. */
  claveFolio: string;
  nombre: string;
  /** Municipio piloto (Querétaro, Corregidora, El Marqués): conectado desde el inicio. */
  piloto: boolean;
  /** Identificador del CAD que atiende este municipio (ver configuración del API). */
  cadId: string;
  /** Polígono de jurisdicción [lng, lat] (INEGI 2022 simplificado). */
  geocerca: readonly (readonly [number, number])[];
}

export const CLAVE_ESTADO_QRO = '22';

/**
 * Respaldo estatal: el CQ CIAS (Centro de Información y Análisis para la Seguridad de Querétaro), que
 * opera el 911 y el 089 en todo el estado. Recibe lo que cae en un municipio sin conectar o sin
 * capacidad, los reportes anónimos (089) y lo que no acusa un CAD municipal a tiempo.
 * El identificador técnico `c5-queretaro` se conserva por compatibilidad con el contrato v1.
 */
export const CAD_ESTATAL_ID = 'c5-queretaro';
export const NOMBRE_RESPALDO_ESTATAL = 'CQ CIAS';
export const NOMBRE_RESPALDO_ESTATAL_LARGO = 'Centro de Información y Análisis para la Seguridad de Querétaro';

/**
 * Actor 19: el Estado, responsable de accidentes estatales y tramos estatales (definido por Diego).
 * PENDIENTE de decisión de Diego: su clave, si es un CAD con bandeja propia o solo un destino de
 * transferencia, y el criterio que hace estatal a un folio. Por eso no tiene `cadId` ni enruta nada.
 */
export const ACTOR_ESTADO = {
  id: 'estado',
  nombre: 'Estado',
  ambito: 'Accidentes estatales y tramos estatales',
  clave: null,
  pendiente: 'Clave, tipo de actor (CAD con bandeja propia o destino de transferencia) y regla de enrutado: pendientes de decisión de Diego.',
} as const;

/** `cad-` + nombre sin acentos, en minúsculas y con guiones: "San Juan del Río" → `cad-san-juan-del-rio`. */
export function cadIdDeNombre(nombre: string): string {
  return `cad-${nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

const PILOTOS = new Set(['014', '006', '011']);

/** Los 18 municipios, ordenados por clave INEGI. */
export const MUNICIPIOS_QRO: readonly Municipio[] = MUNICIPIOS_QRO_INEGI.map((m) => ({
  clave: `${CLAVE_ESTADO_QRO}${m.clave}`,
  claveFolio: m.clave,
  nombre: m.nombre,
  piloto: PILOTOS.has(m.clave),
  cadId: cadIdDeNombre(m.nombre),
  geocerca: m.poligono,
}));

/** Municipios piloto (Querétaro 014, Corregidora 006, El Marqués 011). */
export const MUNICIPIOS_PILOTO: readonly Municipio[] = MUNICIPIOS_QRO.filter((m) => m.piloto);

/** Todos los `cadId` del contrato: los 18 municipios y el C5. */
export const CAD_IDS: readonly string[] = [...MUNICIPIOS_QRO.map((m) => m.cadId), CAD_ESTATAL_ID];

/** Por clave de 5 dígitos (22014). Acepta también la de 3 (014) de folios anteriores. */
export function municipioPorClave(clave: string): Municipio | undefined {
  return MUNICIPIOS_QRO.find((m) => m.clave === clave || m.claveFolio === clave);
}

/** Normaliza una clave de municipio guardada con 3 dígitos (014) a la de 5 (22014). */
export function claveCompleta(clave: string | null | undefined): string | null {
  if (!clave) return null;
  return municipioPorClave(clave)?.clave ?? clave;
}

export function municipioPorCad(cadId: string): Municipio | undefined {
  return MUNICIPIOS_QRO.find((m) => m.cadId === cadId);
}

/** "CAD San Juan del Río" o "CQ CIAS". */
export function nombreDeCad(cadId: string): string {
  if (cadId === CAD_ESTATAL_ID) return NOMBRE_RESPALDO_ESTATAL;
  const m = municipioPorCad(cadId);
  return m ? `CAD ${m.nombre}` : cadId;
}
export { FUENTE_GEOCERCAS } from './municipios-qro';
