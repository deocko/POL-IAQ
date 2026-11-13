import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { PerfilSchema, type Perfil } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import type { Ciudadano } from '../almacen/modelos';
import { CiudadanoGuard } from '../auth/auth.guard';
import { ZodPipe } from '../comun/zod.pipe';

/** Lugares guardados y escenarios de acceso rápido del ciudadano. */
@Controller('v1/perfil')
@UseGuards(CiudadanoGuard)
export class PerfilController {
  constructor(@Inject(Almacen) private readonly almacen: Almacen) {}

  @Get()
  perfil(@Req() req: { ciudadano: Ciudadano }) {
    return this.almacen.perfil(req.ciudadano.id);
  }

  /** Reemplaza el perfil completo (la app manda la lista entera). */
  @Put()
  async guardar(@Req() req: { ciudadano: Ciudadano }, @Body(new ZodPipe(PerfilSchema)) body: Perfil) {
    await this.almacen.guardarPerfil(req.ciudadano.id, body);
    await this.almacen.auditar({ actor: `ciudadano:${req.ciudadano.id}`, accion: 'perfil_actualizado', detalle: { lugares: body.lugares.length, escenarios: body.escenarios.length } });
    return body;
  }
}
