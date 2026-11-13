import { ETIQUETAS_CIUDADANO, preguntasPendientes, protocoloDe, respuestasDe, type Protocolo } from '@pol-iaq/shared';
import type { Reporte } from '../almacen/modelos';

/** Lo que el ciudadano puede ver de su reporte. */
export function vistaCiudadano(r: Reporte, protocolo: Protocolo) {
  const pendientes = preguntasPendientes(protocolo, r.incidenteId, respuestasDe(r.cuestionario.entradas));
  return {
    folio: r.folio,
    incidenteId: r.incidenteId,
    estado: r.estado,
    estadoTexto: ETIQUETAS_CIUDADANO[r.estado],
    ubicacion: r.ubicacion,
    municipioClave: r.municipioClave,
    asistenciaDirecta: r.asistenciaDirecta,
    escenarioId: r.escenarioId ?? null,
    unidad: r.unidad ? { etiqueta: r.unidad.etiqueta, corporacion: r.unidad.corporacion, etaMinutos: r.unidad.etaMinutos, lat: r.unidad.lat, lng: r.unidad.lng, rumbo: r.unidad.rumbo, actualizadoEn: r.unidad.actualizadoEn } : null,
    cuestionario: {
      protocoloVersion: r.cuestionario.protocoloVersion,
      protocoloEstado: r.cuestionario.protocoloEstado,
      entradas: r.cuestionario.entradas.map(({ preguntaId, pregunta, respuesta, respuestaTexto, via, en }) => ({ preguntaId, pregunta, respuesta, respuestaTexto, via, en })),
      /** Preguntas del protocolo vigente que faltan; la app las hace con la despachadora virtual. */
      pendientes: pendientes.map((q) => q.id),
    },
    canalizacion: r.canalizacion,
    recomendaciones: protocoloDe(protocolo, r.incidenteId)?.recomendaciones ?? [],
    evidencias: r.evidencias.map((e) => ({ id: e.id, tipo: e.tipo, estado: e.estado })),
    mensajes: r.mensajes,
    historial: r.historial,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
  };
}
