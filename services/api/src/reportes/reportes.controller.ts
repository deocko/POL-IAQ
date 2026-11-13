import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CrearReporteSchema, MensajeSchema, SolicitarEvidenciaSchema, type CrearReporte, type SolicitarEvidencia } from '@pol-iaq/shared';
import { CiudadanoGuard } from '../auth/auth.guard';
import type { Ciudadano } from '../almacen/modelos';
import { ZodPipe } from '../comun/zod.pipe';
import { ReportesService } from './reportes.service';
import { vistaCiudadano } from './vista';

type Req_ = { ciudadano: Ciudadano; body: unknown };

@Controller('v1/reportes')
@UseGuards(CiudadanoGuard)
export class ReportesController {
  constructor(@Inject(ReportesService) private readonly reportes: ReportesService) {}

  @Post()
  crear(@Req() req: Req_, @Body(new ZodPipe(CrearReporteSchema)) body: CrearReporte) {
    return vistaCiudadano(this.reportes.crear(req.ciudadano, body));
  }

  @Get()
  listar(@Req() req: Req_) {
    return this.reportes.listar(req.ciudadano).map(vistaCiudadano);
  }

  @Get(':folio')
  detalle(@Req() req: Req_, @Param('folio') folio: string) {
    return vistaCiudadano(this.reportes.delCiudadano(req.ciudadano, folio));
  }

  @Post(':folio/cancelar')
  @HttpCode(200)
  cancelar(@Req() req: Req_, @Param('folio') folio: string) {
    return vistaCiudadano(this.reportes.cancelar(req.ciudadano, folio));
  }

  @Post(':folio/mensajes')
  mensaje(@Req() req: Req_, @Param('folio') folio: string, @Body(new ZodPipe(MensajeSchema)) body: { texto: string }) {
    return vistaCiudadano(this.reportes.agregarMensaje(req.ciudadano, folio, body.texto));
  }

  @Post(':folio/evidencias')
  evidencia(@Req() req: Req_, @Param('folio') folio: string, @Body(new ZodPipe(SolicitarEvidenciaSchema)) body: SolicitarEvidencia) {
    return this.reportes.solicitarEvidencia(req.ciudadano, folio, body);
  }

  @Put(':folio/evidencias/:id/contenido')
  contenido(@Req() req: Req_, @Param('folio') folio: string, @Param('id') id: string) {
    const e = this.reportes.recibirContenido(req.ciudadano, folio, id, req.body as Buffer);
    return { evidenciaId: e.id, estado: e.estado, sha256: e.sha256Servidor };
  }
}
