import {
  CAD_ESTATAL_ID, ESTADOS, ETIQUETAS_CIUDADANO, MUNICIPIOS_PILOTO, incidentePorId, preguntasPendientes, protocoloDe, puedeTransicionar, respuestasDe, type Protocolo,
} from '@pol-iaq/shared';
import type { Ciudadano, Reporte } from '../almacen/modelos';
import { cuestionarioParaCad, type DespachadorCadService } from '../cad/despachador.service';
import type { Config } from '../config';

/** CAD conocidos, con su nombre para la consola. */
export const CADS_CONOCIDOS: { id: string; nombre: string }[] = [
  ...MUNICIPIOS_PILOTO.map((m) => ({ id: m.cadId, nombre: `CAD ${m.nombre}` })),
  { id: CAD_ESTATAL_ID, nombre: 'C5 Querétaro (estatal)' },
];

export const consolaOpera = (config: Config, cadId: string) => config.cads[cadId]?.modo === 'consola';

/**
 * Lo que ve el operador: reportante, transcripción del cuestionario,
 * canalización, enlaces firmados a la evidencia y qué puede hacer.
 */
export function vistaOperador(r: Reporte, ciudadano: Ciudadano | undefined, protocolo: Protocolo, config: Config, despachador: DespachadorCadService) {
  const incidente = incidentePorId(r.incidenteId);
  const pendientes = preguntasPendientes(protocolo, r.incidenteId, respuestasDe(r.cuestionario.entradas));
  const operable = consolaOpera(config, r.cadId);
  // Sin acuse a tiempo, el despachador lo escala al C5 (ver DespachadorCadService).
  const escalaAlC5En = r.estado === 'recibido' && !r.folioCad && r.cadId !== CAD_ESTATAL_ID
    ? new Date(new Date(r.creadoEn).getTime() + config.esperaAcuseSeg * 1000).toISOString()
    : null;
  return {
    folio: r.folio,
    folioCad: r.folioCad ?? null,
    cadId: r.cadId,
    municipioClave: r.municipioClave,
    incidenteId: r.incidenteId,
    incidente: incidente?.nombreCiudadano ?? r.incidenteId,
    categoria: incidente?.categoria ?? null,
    codigoCnie: r.codigoCnie,
    prioridad: r.prioridad,
    estado: r.estado,
    estadoTexto: ETIQUETAS_CIUDADANO[r.estado],
    asistenciaDirecta: r.asistenciaDirecta,
    escenarioId: r.escenarioId ?? null,
    ubicacion: r.ubicacion,
    descripcion: r.descripcion ?? null,
    reportante: ciudadano ? { nombre: ciudadano.nombre, telefono: ciudadano.telefono, confiabilidad: ciudadano.confiabilidad } : null,
    cuestionario: { ...cuestionarioParaCad(r), pendientes: pendientes.map((q) => q.texto) },
    canalizacion: r.canalizacion,
    recomendaciones: protocoloDe(protocolo, r.incidenteId)?.recomendaciones ?? [],
    unidad: r.unidad ?? null,
    evidencias: r.evidencias.filter((e) => e.estado === 'verificada').map((e) => despachador.enlaceEvidencia(r, e)),
    mensajes: r.mensajes,
    historial: r.historial,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
    escalaAlC5En,
    /** Solo los CAD en modo consola se operan aquí; los demás despachan en su propio sistema. */
    operable,
    transiciones: operable ? ESTADOS.filter((e) => puedeTransicionar(r.estado, e)) : [],
  };
}

export type VistaOperador = ReturnType<typeof vistaOperador>;
