import { BadRequestException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { EventoDesdeCadSchema, verificarFirma } from '@pol-iaq/shared';
import { AvlService } from '../despacho/avl.service';
import { Almacen } from '../almacen/almacen';
import { CONFIG, type Config } from '../config';
import { DespachadorCadService } from './despachador.service';
import { EventosCadService } from './eventos-cad.service';

const AvlLoteSchema = z.object({
  posiciones: z.array(z.object({ unidadId: z.string().min(1), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), rumbo: z.number().optional(), en: z.iso.datetime().optional() })).max(500),
});

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
    @Inject(AvlService) private readonly avl: AvlService,
  ) {}

  private verificar(cadId: string, ts: string, firma: string, cuerpo: string) {
    const cad = this.config.cads[cadId];
    if (!cad?.secreto || !firma || !verificarFirma(cad.secreto, Number(ts), cuerpo, firma)) throw new UnauthorizedException({ codigo: 'firma_invalida' });
  }

  /**
   * Posiciones GPS (AVL) de las unidades del CAD, en lote y firmadas igual que
   * los eventos. Alimentan la asignación por cercanía y el mapa de la consola.
   */
  @Post('avl')
  @HttpCode(202)
  avlLote(@Param('cadId') cadId: string, @Headers('x-poliaq-timestamp') ts: string, @Headers('x-poliaq-firma') firma: string, @Req() req: { rawBody?: Buffer }) {
    const cuerpo = req.rawBody?.toString('utf8') ?? '';
    this.verificar(cadId, ts, firma, cuerpo);
    let json: unknown;
    try { json = JSON.parse(cuerpo); } catch { throw new BadRequestException({ codigo: 'json_invalido' }); }
    const p = AvlLoteSchema.safeParse(json);
    if (!p.success) throw new BadRequestException({ codigo: 'avl_invalido', errores: p.error.issues });
    const propias = new Set(this.config.unidades.filter((u) => u.cadId === cadId).map((u) => u.unidadId));
    let aceptadas = 0;
    for (const x of p.data.posiciones) {
      if (!propias.has(x.unidadId)) continue;
      this.avl.actualizar(x.unidadId, x);
      aceptadas++;
    }
    return { aceptadas };
  }

  @Post('eventos')
  @HttpCode(202)
  async recibir(
    @Param('cadId') cadId: string,
    @Headers('x-poliaq-timestamp') ts: string,
    @Headers('x-poliaq-firma') firma: string,
    @Req() req: { rawBody?: Buffer },
  ) {
    const cuerpo = req.rawBody?.toString('utf8') ?? '';
    this.verificar(cadId, ts, firma, cuerpo);

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
