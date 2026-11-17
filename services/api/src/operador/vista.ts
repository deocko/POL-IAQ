import {
  CAD_ESTATAL_ID, CAD_IDS, ESTADOS, ETIQUETAS_CIUDADANO, etiquetaCnie, municipioPorCad, nombreDeCad, incidentePorId, medirTiempos, preguntasPendientes, reportanteVisible, protocoloDe, textoRespaldo, puedeTransicionar, respuestasDe, type Protocolo,
} from '@pol-iaq/shared';
import type { Ciudadano, Reporte } from '../almacen/modelos';
import { cuestionarioParaCad, type DespachadorCadService } from '../cad/despachador.service';
import type { Config } from '../config';

/** Los CAD del contrato (18 municipios y el C5), con su nombre y clave INEGI de 5 dígitos. */
export const CADS_CONOCIDOS: { id: string; nombre: string; clave: string | null; piloto: boolean }[] = CAD_IDS.map((id) => ({
  id,
  nombre: nombreDeCad(id),
  clave: municipioPorCad(id)?.clave ?? null,
  piloto: municipioPorCad(id)?.piloto ?? false,
}));

export const consolaOpera = (config: Config, cadId: string) => config.cads[cadId]?.modo === 'consola';

/**
 * Lo que ve el operador: reportante, transcripción del cuestionario,
 * canalización, enlaces firmados a la evidencia y qué puede hacer.
 */
export function vistaOperador(r: Reporte, ciudadano: Ciudadano | undefined, protocolo: Protocolo, config: Config, despachador: DespachadorCadService) {
  const incidente = incidentePorId(r.incidenteId);
  const pendientes = preguntasPendientes(protocolo, r.incidenteId, respuestasDe(r.cuestionario.entradas));
  const operable = consolaOpera(config, r.cadId);
  // Sin acuse a tiempo, el despachador lo escala al CQ CIAS (ver DespachadorCadService).
  const escalaAlC5En = r.estado === 'recibido' && !r.folioCad && r.cadId !== CAD_ESTATAL_ID
    ? new Date(new Date(r.creadoEn).getTime() + config.esperaAcuseSeg * 1000).toISOString()
    : null;
  return {
    folio: r.folio,
    folioCad: r.folioCad ?? null,
    cadId: r.cadId,
    municipioClave: r.municipioClave,
    incidenteId: r.incidenteId,
    incidente: incidente?.nombreCorto ?? r.incidenteId,
    categoria: incidente?.categoria ?? null,
    codigoCnie: r.codigoCnie,
    /** Clasificación CNIE V 3.0 (null en folios anteriores o en "Otra emergencia" sin clasificar). */
    cnie: r.cnie ?? null,
    /** "CNIE 30202 · Seguridad / Armas y explosivos / Detonación por arma de fuego · ALTA". */
    cnieEtiqueta: r.cnie ? etiquetaCnie(r.cnie) : null,
    /** Correcciones del código (copia de la bitácora `cnie_correcciones`). */
    correccionesCnie: r.correccionesCnie ?? [],
    prioridad: r.prioridad,
    estado: r.estado,
    estadoTexto: ETIQUETAS_CIUDADANO[r.estado],
    asistenciaDirecta: r.asistenciaDirecta,
    escenarioId: r.escenarioId ?? null,
    ubicacion: r.ubicacion,
    descripcion: r.descripcion ?? null,
    reportante: ciudadano ? reportanteVisible(r, ciudadano) : null,
    cuestionario: { ...cuestionarioParaCad(r), pendientes: pendientes.map((q) => q.texto) },
    canalizacion: r.canalizacion,
    recomendaciones: protocoloDe(protocolo, r.incidenteId)?.recomendaciones ?? [],
    unidad: r.unidad ?? null,
    evidencias: r.evidencias.filter((e) => e.estado === 'verificada').map((e) => despachador.enlaceEvidencia(r, e)),
    mensajes: r.mensajes,
    historial: r.historial,
    tiempos: medirTiempos(r.historial, r.prioridad),
    opinion: r.opinion ?? null,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
    escalaAlC5En,
    /** Cómo se enrutó al crearse (CAD de origen, motivo del respaldo y canal). Sin datos personales. */
    ruta: r.ruta ?? { cadOrigen: r.cadId, motivo: null, canal: '911' as const },
    /** "Atiende CQ CIAS — municipio sin capacidad (…)", o null si lo atiende el municipio. */
    respaldo: textoRespaldo(r.ruta),
    /** Solo los CAD en modo consola se operan aquí; los demás despachan en su propio sistema. */
    operable,
    transiciones: operable ? ESTADOS.filter((e) => puedeTransicionar(r.estado, e)) : [],
  };
}

export type VistaOperador = ReturnType<typeof vistaOperador>;
