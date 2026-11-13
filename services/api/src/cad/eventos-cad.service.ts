import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EventoDesdeCad } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import type { Reporte } from '../almacen/modelos';
import { ReportesService } from '../reportes/reportes.service';
import { AvisosSmsService } from '../sms/avisos-sms.service';

export type ResultadoEvento = { aceptado: true; duplicado?: true; descartado?: 'secuencia_antigua' };

/**
 * Aplica los eventos que llegan de un CAD, sea por webhook firmado o desde la
 * consola web de Pol-IAQ: idempotencia, orden por secuencia, auditoría,
 * aviso en tiempo real y SMS al ciudadano.
 */
@Injectable()
export class EventosCadService {
  constructor(
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(ReportesService) private readonly reportes: ReportesService,
    @Inject(AvisosSmsService) private readonly avisos: AvisosSmsService,
  ) {}

  /**
   * - `actor` queda en la auditoría (`cad:<id>` u `operador:<usuario>`).
   * - `antes` corre con el reporte bloqueado, antes de aplicar, para validaciones extra.
   * - `secuenciaSiguiente`: la consola no lleva secuencia propia; toma la siguiente del folio.
   */
  procesar(cadId: string, ev: EventoDesdeCad, op: { actor?: string; antes?: (r: Reporte) => void; secuenciaSiguiente?: boolean } = {}): Promise<ResultadoEvento> {
    const actor = op.actor ?? `cad:${cadId}`;
    return this.almacen.conReporte(ev.folio, async () => {
      const r = await this.almacen.reporte(ev.folio);
      if (!r) throw new NotFoundException({ codigo: 'folio_no_encontrado' });
      if (r.cadId !== cadId) throw new ForbiddenException({ codigo: 'folio_de_otra_jurisdiccion' });
      if (op.secuenciaSiguiente) ev = { ...ev, secuencia: r.secuenciaEntrada + 1 };
      op.antes?.(r);
      if (!(await this.almacen.marcarEventoProcesado(ev.eventoId, cadId, ev.folio))) return { aceptado: true, duplicado: true };
      // Las posiciones pueden llegar desordenadas: se descartan las viejas sin error.
      if (ev.secuencia <= r.secuenciaEntrada) return { aceptado: true, descartado: 'secuencia_antigua' };

      const unidadAntes = r.unidad?.unidadId;
      await this.aplicar(cadId, r, ev, actor);
      // Tras una transferencia, el CAD destino empieza su propia secuencia.
      if (ev.tipo !== 'incidente.transferido') r.secuenciaEntrada = ev.secuencia;
      await this.almacen.auditar({ actor, accion: ev.tipo, folio: ev.folio });
      await this.reportes.tocar(r, cadId);

      if (ev.tipo === 'unidad.asignada' && r.unidad && r.unidad.unidadId !== unidadAntes) this.avisos.unidadAsignada(r);
      if (ev.tipo === 'incidente.transferido') this.avisos.transferido(r);
      return { aceptado: true };
    });
  }

  private async aplicar(cadId: string, r: Reporte, ev: EventoDesdeCad, actor: string) {
    const ahora = new Date().toISOString();
    switch (ev.tipo) {
      case 'incidente.recibido':
        r.folioCad = ev.datos.folioCad;
        this.reportes.cambiarEstado(r, 'validado', 'Recibido por el CAD');
        break;
      case 'unidad.asignada':
        r.unidad = { unidadId: ev.datos.unidadId, corporacion: ev.datos.corporacion, etiqueta: ev.datos.etiqueta, etaMinutos: ev.datos.etaMinutos };
        if (r.estado === 'recibido') this.reportes.cambiarEstado(r, 'validado');
        this.reportes.cambiarEstado(r, 'asignado');
        break;
      case 'unidad.posicion':
        if (!r.unidad || r.unidad.unidadId !== ev.datos.unidadId) return;
        Object.assign(r.unidad, { lat: ev.datos.lat, lng: ev.datos.lng, rumbo: ev.datos.rumbo, etaMinutos: ev.datos.etaMinutos ?? r.unidad.etaMinutos, actualizadoEn: ahora });
        if (r.estado === 'asignado') this.reportes.cambiarEstado(r, 'en_camino');
        break;
      case 'incidente.estado':
        this.reportes.cambiarEstado(r, ev.datos.estado, ev.datos.nota);
        break;
      case 'incidente.transferido':
        this.reportes.cambiarEstado(r, 'transferido', ev.datos.motivo);
        r.cadId = ev.datos.cadDestinoId;
        r.unidad = undefined;
        r.secuenciaEntrada = 0;
        await this.almacen.auditar({ actor, accion: 'transferencia', folio: r.folio, detalle: { origen: cadId, destino: ev.datos.cadDestinoId } });
        break;
      case 'mensaje.operador':
        r.mensajes.push({ id: randomUUID(), autor: 'operador', nombreAutor: ev.datos.autor, texto: ev.datos.texto, en: ahora });
        break;
    }
  }
}
