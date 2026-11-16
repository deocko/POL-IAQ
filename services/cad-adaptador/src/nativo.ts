/**
 * Formato «nativo» de REFERENCIA de un CAD municipal.
 *
 * No es el formato de ningún proveedor real: es un JSON sencillo que sirve de ejemplo y de prueba
 * (lo habla el simulador en modo `nativo`). Para conectar un CAD real se escribe, junto a este
 * archivo, un conector con las mismas piezas (`haciaCad`, `desdeCad` y los esquemas de entrada)
 * contra la documentación del proveedor. El contrato con POL-IAQ (v1) no cambia.
 */
import { z } from 'zod';
import type { EventoDesdeCad, EventoHaciaCad } from '@pol-iaq/shared';

const ESTATUS = { EN_CAMINO: 'en_camino', EN_SITIO: 'en_sitio', CERRADO: 'cerrado', IMPROCEDENTE: 'improcedente' } as const;

/** Incidente tal como lo recibe el CAD (alta). Lleva datos del reportante solo en tránsito. */
export interface IncidenteNativo {
  folio: string;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  /** Clave INEGI de 5 dígitos (22001–22018). */
  municipioInegi: string | null;
  cnie: { codigo: string | null; tipo: string; subtipo: string; descripcion: string; prioridad: string | null } | null;
  ubicacion: { lat: number; lon: number; precisionM?: number; referencia?: string };
  descripcion?: string;
  corporacion: string;
  alertas: string[];
  transcripcion: string;
  asistenciaDirecta: boolean;
  reportante: { nombre: string; telefono: string; identidad?: string };
  evidencias: { tipo: string; url: string; sha256: string; expira: string }[];
  /** Solo en reenvíos de folios en curso (migración B→A). */
  enCurso?: { estatus: string; folioCad: string | null; unidad: string | null };
}

export interface ActualizacionNativa {
  folio: string;
  cambios: {
    ubicacion?: { lat: number; lon: number; referencia?: string };
    cnie?: IncidenteNativo['cnie'];
    transcripcion?: string;
    cancelado?: boolean;
    mensajeCiudadano?: string;
    evidencias?: IncidenteNativo['evidencias'];
  };
}

const cnieNativo = (c: { tipo: { nombre: string }; subtipo: { codigo: string; nombre: string }; incidente: { codigo: string; nombre: string } | null; prioridad: string | null } | null | undefined): IncidenteNativo['cnie'] =>
  c ? { codigo: c.incidente?.codigo ?? null, tipo: c.tipo.nombre, subtipo: c.subtipo.nombre, descripcion: c.incidente?.nombre ?? c.subtipo.nombre, prioridad: c.prioridad } : null;

const evidenciasNativas = (xs: { tipo: string; url: string; sha256: string; expiraEn: string }[]) => xs.map((e) => ({ tipo: e.tipo, url: e.url, sha256: e.sha256, expira: e.expiraEn }));

/** Contrato v1 → CAD. */
export function haciaCad(ev: EventoHaciaCad): { ruta: string; cuerpo: IncidenteNativo | ActualizacionNativa } {
  if (ev.tipo === 'incidente.creado') {
    const d = ev.datos;
    return {
      ruta: '/incidentes',
      cuerpo: {
        folio: ev.folio,
        prioridad: d.prioridad.toUpperCase() as IncidenteNativo['prioridad'],
        municipioInegi: d.municipioClave,
        cnie: cnieNativo(d.cnie),
        ubicacion: { lat: d.ubicacion.lat, lon: d.ubicacion.lng, precisionM: d.ubicacion.precisionMetros, referencia: d.ubicacion.referencia },
        descripcion: d.descripcion,
        corporacion: d.canalizacion.corporaciones[0] ?? d.corporacionSugerida,
        alertas: d.canalizacion.alertas,
        transcripcion: d.cuestionario.transcripcion,
        asistenciaDirecta: d.asistenciaDirecta,
        reportante: { nombre: d.reportante.nombre, telefono: d.reportante.telefono, identidad: d.reportante.identidad },
        evidencias: evidenciasNativas(d.evidencias),
        ...(d.estadoActual && { enCurso: { estatus: d.estadoActual.estado.toUpperCase(), folioCad: d.estadoActual.folioCad, unidad: d.estadoActual.unidad?.unidadId ?? null } }),
      },
    };
  }
  const d = ev.datos;
  return {
    ruta: `/incidentes/${encodeURIComponent(ev.folio)}/actualizaciones`,
    cuerpo: {
      folio: ev.folio,
      cambios: {
        ...(d.ubicacion && { ubicacion: { lat: d.ubicacion.lat, lon: d.ubicacion.lng, referencia: d.ubicacion.referencia } }),
        ...(d.cnie !== undefined && { cnie: cnieNativo(d.cnie) }),
        ...(d.cuestionario && { transcripcion: d.cuestionario.transcripcion }),
        ...(d.cancelado !== undefined && { cancelado: d.cancelado }),
        ...(d.mensajeCiudadano && { mensajeCiudadano: d.mensajeCiudadano }),
        ...(d.nuevaEvidencia && { evidencias: evidenciasNativas(d.nuevaEvidencia) }),
      },
    },
  };
}

/** Evento del CAD en su formato. `idEvento` (si lo manda) hace idempotentes sus reintentos. */
export const EventoNativoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('ACUSE'), folio: z.string(), idEvento: z.string().optional(), folioCad: z.string(), operador: z.string().optional(), cnie: z.string().optional() }),
  z.object({ tipo: z.literal('ASIGNACION'), folio: z.string(), idEvento: z.string().optional(), unidad: z.string(), corporacion: z.string(), descripcionUnidad: z.string(), eta: z.number().nonnegative().optional() }),
  z.object({ tipo: z.literal('GPS'), folio: z.string(), idEvento: z.string().optional(), unidad: z.string(), lat: z.number(), lon: z.number(), rumbo: z.number().optional(), eta: z.number().optional() }),
  z.object({ tipo: z.literal('ESTATUS'), folio: z.string(), idEvento: z.string().optional(), estatus: z.enum(['EN_CAMINO', 'EN_SITIO', 'CERRADO', 'IMPROCEDENTE']), nota: z.string().optional() }),
  z.object({ tipo: z.literal('TRANSFERENCIA'), folio: z.string(), idEvento: z.string().optional(), destino: z.string(), corporacionDestino: z.string().optional(), motivo: z.string().optional() }),
  z.object({ tipo: z.literal('MENSAJE'), folio: z.string(), idEvento: z.string().optional(), texto: z.string().min(1).max(1000), autor: z.string() }),
  z.object({ tipo: z.literal('RECLASIFICACION'), folio: z.string(), idEvento: z.string().optional(), cnie: z.string(), cnieSecundario: z.string().nullable().optional(), motivo: z.string().max(500).optional(), operador: z.string().optional() }),
]);
export type EventoNativo = z.infer<typeof EventoNativoSchema>;

export const AvlNativoSchema = z.object({
  posiciones: z.array(z.object({ unidad: z.string().min(1), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), rumbo: z.number().optional(), fecha: z.iso.datetime().optional() })).max(5000),
});

type SinBase<T> = T extends unknown ? Omit<T, 'eventoId' | 'secuencia' | 'ocurridoEn'> : never;

/** CAD → contrato v1 (sin eventoId ni secuencia; los pone el adaptador). */
export function desdeCad(n: EventoNativo): SinBase<EventoDesdeCad> {
  switch (n.tipo) {
    case 'ACUSE':
      return { tipo: 'incidente.recibido', folio: n.folio, datos: { folioCad: n.folioCad, operador: n.operador, ...(n.cnie && { codigoCnie: n.cnie }) } };
    case 'ASIGNACION':
      return { tipo: 'unidad.asignada', folio: n.folio, datos: { unidadId: n.unidad, corporacion: n.corporacion, etiqueta: n.descripcionUnidad, etaMinutos: n.eta } };
    case 'GPS':
      return { tipo: 'unidad.posicion', folio: n.folio, datos: { unidadId: n.unidad, lat: n.lat, lng: n.lon, rumbo: n.rumbo, etaMinutos: n.eta } };
    case 'ESTATUS':
      return { tipo: 'incidente.estado', folio: n.folio, datos: { estado: ESTATUS[n.estatus], nota: n.nota } };
    case 'TRANSFERENCIA':
      return { tipo: 'incidente.transferido', folio: n.folio, datos: { cadDestinoId: n.destino, corporacionDestino: n.corporacionDestino, motivo: n.motivo } };
    case 'MENSAJE':
      return { tipo: 'mensaje.operador', folio: n.folio, datos: { texto: n.texto, autor: n.autor } };
    case 'RECLASIFICACION':
      return { tipo: 'incidente.reclasificado', folio: n.folio, datos: { codigoCnie: n.cnie, codigoCnieSecundario: n.cnieSecundario, motivo: n.motivo, operador: n.operador } };
  }
}
