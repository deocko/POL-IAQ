import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token firmado mínimo (payload.firma, ambos base64url).
 * TODO(fase 1): migrar a JWT emitidos por el proveedor OIDC (Keycloak) con
 * rotación de llaves; este formato es solo para el scaffold.
 */
export interface Sesion {
  sub: string;
  rol: 'ciudadano';
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function emitirToken(secreto: string, sub: string, duracionSeg = 60 * 60 * 24 * 30): string {
  const payload = b64(JSON.stringify({ sub, rol: 'ciudadano', exp: Math.floor(Date.now() / 1000) + duracionSeg } satisfies Sesion));
  const firma = b64(createHmac('sha256', secreto).update(payload).digest());
  return `${payload}.${firma}`;
}

export function leerToken(secreto: string, token: string): Sesion | null {
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = Buffer.from(b64(createHmac('sha256', secreto).update(payload).digest()));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Sesion;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}
