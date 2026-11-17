import { BadRequestException } from '@nestjs/common';
import { claveCompleta, enRango, medirTiempos, municipioPorClave, rangoPeriodo, type FilaEstadistica, type Periodo } from '@pol-iaq/shared';
import type { Reporte } from '../almacen/modelos';

/** Lo mínimo del folio para la estadística: sin nombre, teléfono, ubicación ni descripción. */
export function filaEstadistica(r: Reporte): FilaEstadistica {
  return {
    folio: r.folio,
    cadId: r.cadId,
    municipioClave: claveCompleta(r.municipioClave),
    creadoEn: r.creadoEn,
    prioridad: r.prioridad,
    estado: r.estado,
    cnie: r.cnie ?? null,
    unidad: r.unidad ? { unidadId: r.unidad.unidadId, etiqueta: r.unidad.etiqueta, corporacion: r.unidad.corporacion } : null,
    tiempos: medirTiempos(r.historial, r.prioridad),
    queja: !!r.opinion?.queja,
    calificacion: r.opinion?.calificacion ?? null,
    cadOrigen: r.ruta?.cadOrigen ?? r.cadId,
    respaldo: r.ruta?.motivo ?? null,
    canal: r.ruta?.canal ?? '911',
  };
}

export interface FiltroEstadistica {
  cadId?: string;
  municipio?: string;
  periodo?: string;
  fecha?: string;
  desde?: string;
  hasta?: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Rango de fechas locales [desde, hasta) del filtro, y su etiqueta. Sin periodo ni fechas = todo. */
export function rangoDe(f: FiltroEstadistica): { desde?: string; hasta?: string; etiqueta: string; periodo: Periodo | 'personalizado' | 'todo' } {
  if (f.periodo) {
    if (!['diario', 'semanal', 'mensual'].includes(f.periodo)) throw new BadRequestException({ codigo: 'periodo_invalido' });
    const fecha = f.fecha ?? new Date().toISOString().slice(0, 10);
    if (!FECHA.test(fecha)) throw new BadRequestException({ codigo: 'fecha_invalida' });
    return { ...rangoPeriodo(f.periodo as Periodo, fecha), periodo: f.periodo as Periodo };
  }
  for (const x of [f.desde, f.hasta]) if (x && !FECHA.test(x)) throw new BadRequestException({ codigo: 'fecha_invalida' });
  if (!f.desde && !f.hasta) return { etiqueta: 'Todo', periodo: 'todo' };
  return { desde: f.desde, hasta: f.hasta, etiqueta: `${f.desde ?? 'inicio'} a ${f.hasta ?? 'hoy'}`, periodo: 'personalizado' };
}

/** Límites en UTC con un día de holgura (la zona de Querétaro es UTC−6); el corte exacto lo hace `enRango`. */
export function limitesUtc(desde?: string, hasta?: string): [string | null, string | null] {
  const mover = (d: string, dias: number) => new Date(Date.parse(`${d}T00:00:00Z`) + dias * 86400_000).toISOString();
  return [desde ? mover(desde, -1) : null, hasta ? mover(hasta, 1) : null];
}

export function filtrarFilas(filas: FilaEstadistica[], f: FiltroEstadistica, rango: { desde?: string; hasta?: string }) {
  const municipio = f.municipio ? claveCompleta(f.municipio) : null;
  if (f.municipio && !municipioPorClave(f.municipio)) throw new BadRequestException({ codigo: 'municipio_desconocido', mensaje: 'Usa la clave INEGI de 5 dígitos (22001 a 22018).' });
  return filas.filter((x) => (!f.cadId || x.cadId === f.cadId) && (!municipio || x.municipioClave === municipio) && enRango(x.creadoEn, rango.desde, rango.hasta));
}
