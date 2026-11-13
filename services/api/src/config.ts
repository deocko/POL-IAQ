/**
 * Configuración por variables de entorno. Ver .env.example.
 */
export interface CadConfig {
  /** URL a la que Pol-IAQ envía eventos (webhook del adaptador del CAD). */
  webhookUrl: string;
  /** Secreto compartido para firmar en ambos sentidos (HMAC-SHA256). */
  secreto: string;
}

export interface Config {
  puerto: number;
  produccion: boolean;
  secretoTokens: string;
  urlPublica: string;
  /** Código OTP fijo, solo fuera de producción. */
  otpDesarrollo: string;
  cads: Record<string, CadConfig>;
  /** Segundos que se espera el acuse `incidente.recibido` antes de escalar al C5. */
  esperaAcuseSeg: number;
  maxReportesPorHora: number;
  despachoActivo: boolean;
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const produccion = env.NODE_ENV === 'production';
  const secretoTokens = env.TOKEN_SECRET ?? (produccion ? '' : 'solo-desarrollo-no-usar');
  if (!secretoTokens) throw new Error('TOKEN_SECRET es obligatorio en producción');
  return {
    puerto: Number(env.PORT ?? 3000),
    produccion,
    secretoTokens,
    urlPublica: env.PUBLIC_URL ?? 'http://localhost:3000',
    otpDesarrollo: env.OTP_DEV ?? '000000',
    cads: env.CADS_JSON ? (JSON.parse(env.CADS_JSON) as Record<string, CadConfig>) : {},
    esperaAcuseSeg: Number(env.CAD_ACK_TIMEOUT_SEC ?? 30),
    maxReportesPorHora: Number(env.MAX_REPORTS_PER_HOUR ?? 5),
    despachoActivo: env.CAD_DISPATCH !== 'off',
  };
}

export const CONFIG = Symbol('CONFIG');
