import { BadRequestException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { EventoDesdeCadSchema, verificarFirma } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import { CONFIG, type Config } from '../config';
import { DespachadorCadService } from './despachador.service';
import { EventosCadService } from './eventos-cad.service';

/**
 * Entrada de eventos desde los CAD (webhook firmado con HMAC).
 * TODO(fase 2): además de la firma, exigir mTLS y lista de IPs por CAD.
 */
@Controller('v1/cad/:cadId')
export class CadController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
    @Inject(EventosCadService) private readonly eventos: EventosCadService,
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
    if (!cad?.secreto || !firma || !verificarFirma(cad.secreto, Number(ts), cuerpo, firma)) throw new UnauthorizedException({ codigo: 'firma_invalida' });

    let json: unknown;
    try { json = JSON.parse(cuerpo); } catch { throw new BadRequestException({ codigo: 'json_invalido' }); }
    const p = EventoDesdeCadSchema.safeParse(json);
    if (!p.success) throw new BadRequestException({ codigo: 'evento_invalido', errores: p.error.issues });
    const ev = p.data;

    return this.eventos.procesar(cadId, ev);
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
}
