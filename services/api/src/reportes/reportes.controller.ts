import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  CrearReporteSchema, MensajeSchema, ResponderCuestionarioSchema, SolicitarEvidenciaSchema,
  type CrearReporte, type ResponderCuestionario, type SolicitarEvidencia,
} from '@pol-iaq/shared';
import { CiudadanoGuard } from '../auth/auth.guard';
import type { Ciudadano } from '../almacen/modelos';
import { ZodPipe } from '../comun/zod.pipe';
import { ProtocolosService } from '../protocolos/protocolos.service';
import type { Reporte } from '../almacen/modelos';
import { ReportesService } from './reportes.service';
import { vistaCiudadano } from './vista';

type Req_ = { ciudadano: Ciudadano; body: unknown };

@Controller('v1/reportes')
@UseGuards(CiudadanoGuard)
export class ReportesController {
  constructor(
    @Inject(ReportesService) private readonly reportes: ReportesService,
    @Inject(ProtocolosService) private readonly protocolos: ProtocolosService,
  ) {}

  private vista = (r: Reporte) => vistaCiudadano(r, this.protocolos.vigente());

  @Post()
  async crear(@Req() req: Req_, @Body(new ZodPipe(CrearReporteSchema)) body: CrearReporte) {
    return this.vista(await this.reportes.crear(req.ciudadano, body));
  }

  @Get()
  async listar(@Req() req: Req_) {
    return (await this.reportes.listar(req.ciudadano)).map(this.vista);
  }

  @Get(':folio')
  async detalle(@Req() req: Req_, @Param('folio') folio: string) {
    return this.vista(await this.reportes.delCiudadano(req.ciudadano, folio));
  }

  @Post(':folio/cancelar')
  @HttpCode(200)
  async cancelar(@Req() req: Req_, @Param('folio') folio: string) {
    return this.vista(await this.reportes.cancelar(req.ciudadano, folio));
  }

  @Post(':folio/mensajes')
  async mensaje(@Req() req: Req_, @Param('folio') folio: string, @Body(new ZodPipe(MensajeSchema)) body: { texto: string }) {
    return this.vista(await this.reportes.agregarMensaje(req.ciudadano, folio, body.texto));
  }

  /** Respuestas al protocolo de atención (despachadora virtual o formulario). */
  @Post(':folio/cuestionario')
  async cuestionario(@Req() req: Req_, @Param('folio') folio: string, @Body(new ZodPipe(ResponderCuestionarioSchema)) body: ResponderCuestionario) {
    return this.vista(await this.reportes.responderCuestionario(req.ciudadano, folio, body));
  }

  @Post(':folio/evidencias')
  evidencia(@Req() req: Req_, @Param('folio') folio: string, @Body(new ZodPipe(SolicitarEvidenciaSchema)) body: SolicitarEvidencia) {
    return this.reportes.solicitarEvidencia(req.ciudadano, folio, body);
  }

  @Put(':folio/evidencias/:id/contenido')
  async contenido(@Req() req: Req_, @Param('folio') folio: string, @Param('id') id: string) {
    const e = await this.reportes.recibirContenido(req.ciudadano, folio, id, req.body as Buffer);
    return { evidenciaId: e.id, estado: e.estado, sha256: e.sha256Servidor };
  }
}
