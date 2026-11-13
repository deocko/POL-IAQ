import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Firma de webhooks: HMAC-SHA256 sobre `${timestamp}.${cuerpo}`.
 * Encabezados: `X-PolIAQ-Timestamp` y `X-PolIAQ-Firma: v1=<hex>`.
 * Se rechazan mensajes con más de 5 minutos de antigüedad (anti-replay).
 */
export const VENTANA_FIRMA_SEG = 300;

export function firmar(secreto: string, timestamp: number, cuerpo: string): string {
  return 'v1=' + createHmac('sha256', secreto).update(`${timestamp}.${cuerpo}`).digest('hex');
}

export function verificarFirma(secreto: string, timestamp: number, cuerpo: string, firma: string, ahoraSeg = Math.floor(Date.now() / 1000)): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(ahoraSeg - timestamp) > VENTANA_FIRMA_SEG) return false;
  const esperada = Buffer.from(firmar(secreto, timestamp, cuerpo));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
