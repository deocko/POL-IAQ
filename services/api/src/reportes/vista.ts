import { ETIQUETAS_CIUDADANO } from '@pol-iaq/shared';
import type { Reporte } from '../almacen/modelos';

/** Lo que el ciudadano puede ver de su reporte. */
export function vistaCiudadano(r: Reporte) {
  return {
    folio: r.folio,
    incidenteId: r.incidenteId,
    estado: r.estado,
    estadoTexto: ETIQUETAS_CIUDADANO[r.estado],
    ubicacion: r.ubicacion,
    municipioClave: r.municipioClave,
    esPanico: r.esPanico,
    unidad: r.unidad ? { etiqueta: r.unidad.etiqueta, corporacion: r.unidad.corporacion, etaMinutos: r.unidad.etaMinutos, lat: r.unidad.lat, lng: r.unidad.lng, rumbo: r.unidad.rumbo, actualizadoEn: r.unidad.actualizadoEn } : null,
    evidencias: r.evidencias.map((e) => ({ id: e.id, tipo: e.tipo, estado: e.estado })),
    mensajes: r.mensajes,
    historial: r.historial,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
  };
}
