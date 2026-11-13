import { BadRequestException, Controller, ForbiddenException, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { EventoDesdeCadSchema, verificarFirma, type EventoDesdeCad } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import type { Reporte } from '../almacen/modelos';
import { CONFIG, type Config } from '../config';
import { ReportesService } from '../reportes/reportes.service';
import { AvisosSmsService } from '../sms/avisos-sms.service';
import { DespachadorCadService } from './despachador.service';

/**
 * Entrada de eventos desde los CAD (webhook firmado con HMAC).
 * TODO(fase 2): además de la firma, exigir mTLS y lista de IPs por CAD.
 */
@Controller('v1/cad/:cadId')
export class CadController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(ReportesService) private readonly reportes: ReportesService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
    @Inject(AvisosSmsService) private readonly avisos: AvisosSmsService,
  ) {}

  @Post('eventos')
  @HttpCode(202)
  async recibir(
    @Param('cadId') cadId: string,
    @Headers('x-poliaq-timestamp') ts: string,
    @Headers('x-poliaq-firma') firma: string,
    @Req() req: { rawBody?: Buffer },
  ) {
    const cad = this.config.cads[cadId];
    const cuerpo = req.rawBody?.toString('utf8') ?? '';
    if (!cad || !firma || !verificarFirma(cad.secreto, Number(ts), cuerpo, firma)) throw new UnauthorizedException({ codigo: 'firma_invalida' });

    let json: unknown;
    try { json = JSON.parse(cuerpo); } catch { throw new BadRequestException({ codigo: 'json_invalido' }); }
    const p = EventoDesdeCadSchema.safeParse(json);
    if (!p.success) throw new BadRequestException({ codigo: 'evento_invalido', errores: p.error.issues });
    const ev = p.data;

    return this.almacen.conReporte(ev.folio, async () => {
      const r = await this.almacen.reporte(ev.folio);
      if (!r) throw new NotFoundException({ codigo: 'folio_no_encontrado' });
      if (r.cadId !== cadId) throw new ForbiddenException({ codigo: 'folio_de_otra_jurisdiccion' });
      if (!(await this.almacen.marcarEventoProcesado(ev.eventoId, cadId, ev.folio))) return { aceptado: true, duplicado: true };
      // Las posiciones pueden llegar desordenadas: se descartan las viejas sin error.
      if (ev.secuencia <= r.secuenciaEntrada) return { aceptado: true, descartado: 'secuencia_antigua' };

      const unidadAntes = r.unidad?.unidadId;
      await this.aplicar(cadId, r, ev);
      // Tras una transferencia, el CAD destino empieza su propia secuencia.
      if (ev.tipo !== 'incidente.transferido') r.secuenciaEntrada = ev.secuencia;
      await this.almacen.auditar({ actor: `cad:${cadId}`, accion: ev.tipo, folio: ev.folio });
      await this.reportes.tocar(r);

      if (ev.tipo === 'unidad.asignada' && r.unidad && r.unidad.unidadId !== unidadAntes) this.avisos.unidadAsignada(r);
      if (ev.tipo === 'incidente.transferido') this.avisos.transferido(r);
      return { aceptado: true };
    });
  }

  @Get('evidencias/:id')
  async evidencia(@Param('cadId') cadId: string, @Param('id') id: string, @Query('exp') exp: string, @Query('firma') firma: string, @Res() res: Response) {
    if (!this.despachador.firmaEnlaceValida(id, cadId, Number(exp), firma)) throw new UnauthorizedException({ codigo: 'enlace_invalido_o_vencido' });
    const contenido = await this.almacen.contenido(id);
    const evidencia = (await this.almacen.evidencia(id))?.evidencia;
    if (!contenido || !evidencia) throw new NotFoundException({ codigo: 'evidencia_no_encontrada' });
    await this.almacen.auditar({ actor: `cad:${cadId}`, accion: 'evidencia_descargada', detalle: { evidenciaId: id } });
    res.setHeader('content-type', evidencia.mimeType);
    res.setHeader('x-sha256', evidencia.sha256Servidor ?? '');
    res.send(contenido);
  }

  private async aplicar(cadId: string, r: Reporte, ev: EventoDesdeCad) {
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
        await this.almacen.auditar({ actor: `cad:${cadId}`, accion: 'transferencia', folio: r.folio, detalle: { destino: ev.datos.cadDestinoId } });
        break;
      case 'mensaje.operador':
        r.mensajes.push({ id: randomUUID(), autor: 'operador', nombreAutor: ev.datos.autor, texto: ev.datos.texto, en: ahora });
        break;
    }
  }
}
