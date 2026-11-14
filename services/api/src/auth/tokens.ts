import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token firmado mínimo (payload.firma, ambos base64url).
 * TODO(fase 1): migrar a JWT emitidos por el proveedor OIDC (Keycloak) con
 * rotación de llaves; este formato es solo para el scaffold.
 */
export type Sesion =
  | { sub: string; rol: 'ciudadano'; exp: number }
  /** Operador de consola: `sub` es su usuario y `cads` los CAD que opera (`*` = todos). */
  | { sub: string; rol: 'operador'; nombre: string; cads: string[]; exp: number };

type DatosSesion = Sesion extends infer S ? (S extends Sesion ? Omit<S, 'exp'> : never) : never;

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Token de ciudadano (30 días). */
export function emitirToken(secreto: string, sub: string, duracionSeg = 60 * 60 * 24 * 30): string {
  return emitirSesion(secreto, { sub, rol: 'ciudadano' }, duracionSeg);
}

export function emitirSesion(secreto: string, datos: DatosSesion, duracionSeg: number): string {
  const payload = b64(JSON.stringify({ ...datos, exp: Math.floor(Date.now() / 1000) + duracionSeg }));
  const firma = b64(createHmac('sha256', secreto).update(payload).digest());
  return `${payload}.${firma}`;
}

/** Lee un token; con `rol`, solo acepta sesiones de ese rol. */
export function leerToken<R extends Sesion['rol'] = 'ciudadano'>(secreto: string, token: string, rol: R = 'ciudadano' as R): Extract<Sesion, { rol: R }> | null {
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = Buffer.from(b64(createHmac('sha256', secreto).update(payload).digest()));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Sesion;
    return s.rol === rol && s.exp > Date.now() / 1000 ? (s as Extract<Sesion, { rol: R }>) : null;
  } catch {
    return null;
  }
}
