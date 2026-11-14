import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { leerToken } from '../auth/tokens';
import { CONFIG, type Config } from '../config';

export interface OperadorSesion {
  usuario: string;
  nombre: string;
  /** CAD que opera; `*` = todos (supervisión). */
  cads: string[];
}

/** Lee la sesión de operador de un token. Si el operador ya no está en la configuración, la rechaza. */
export function sesionOperador(config: Config, token: string | undefined): OperadorSesion | null {
  const s = token ? leerToken(config.secretoTokens, token, 'operador') : null;
  const o = s && config.operadores.find((x) => x.usuario === s.sub);
  return o ? { usuario: o.usuario, nombre: o.nombre, cads: o.cadIds } : null;
}

export function puedeVer(op: OperadorSesion, cadId: string) {
  return op.cads.includes('*') || op.cads.includes(cadId);
}

@Injectable()
export class OperadorGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    const op = sesionOperador(this.config, auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);
    if (!op) throw new UnauthorizedException({ codigo: 'no_autenticado' });
    req.operador = op;
    return true;
  }
}
