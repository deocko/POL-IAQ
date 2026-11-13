import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { CONFIG, type Config } from '../config';
import { Almacen } from '../almacen/almacen';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from '@pol-iaq/shared';
import { leerToken } from './tokens';

@Injectable()
export class CiudadanoGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config, @Inject(Almacen) private readonly almacen: Almacen) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    const sesion = auth?.startsWith('Bearer ') ? leerToken(this.config.secretoTokens, auth.slice(7)) : null;
    if (!sesion) throw new UnauthorizedException({ codigo: 'no_autenticado' });
    const ciudadano = await this.almacen.ciudadano(sesion.sub);
    if (!ciudadano) throw new UnauthorizedException({ codigo: 'no_autenticado' });
    if (ciudadano.suspendido) throw new ForbiddenException({ codigo: 'cuenta_suspendida' });
    if (ciudadano.avisoPrivacidadVersion !== AVISO_PRIVACIDAD_VERSION || ciudadano.terminosVersion !== TERMINOS_VERSION) {
      throw new ForbiddenException({ codigo: 'aceptacion_legal_pendiente', avisoPrivacidadVersion: AVISO_PRIVACIDAD_VERSION, terminosVersion: TERMINOS_VERSION });
    }
    req.ciudadano = ciudadano;
    return true;
  }
}
