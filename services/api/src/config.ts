/**
 * Configuración por variables de entorno. Ver .env.example.
 */
export interface CadConfig {
  /** URL a la que Pol-IAQ envía eventos (webhook del adaptador del CAD). */
  webhookUrl: string;
  /** Secreto compartido para firmar en ambos sentidos (HMAC-SHA256). */
  secreto: string;
}

export interface SmsConfig {
  proveedor: 'simulado' | 'twilio';
  twilio?: { accountSid: string; authToken: string; remitente: string };
  /** Avisos por SMS al ciudadano (unidad asignada, transferencia). El OTP siempre se envía. */
  avisos: boolean;
}

export interface Config {
  puerto: number;
  produccion: boolean;
  secretoTokens: string;
  urlPublica: string;
  /** Código OTP fijo que se acepta siempre, solo fuera de producción. Vacío = desactivado. */
  otpDesarrollo: string;
  cads: Record<string, CadConfig>;
  /** Segundos que se espera el acuse `incidente.recibido` antes de escalar al C5. */
  esperaAcuseSeg: number;
  maxReportesPorHora: number;
  despachoActivo: boolean;
  /** Sin URL se usa el almacén en memoria (solo fuera de producción). */
  databaseUrl?: string;
  /** Aplica las migraciones pendientes al arrancar. */
  migrarAlIniciar: boolean;
  sms: SmsConfig;
  /**
   * JSON con la versión vigente del protocolo de atención (ver docs/protocolos).
   * Sin archivo se usa el protocolo provisional incluido en @pol-iaq/shared.
   */
  protocoloArchivo?: string;
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const produccion = env.NODE_ENV === 'production';
  const secretoTokens = env.TOKEN_SECRET ?? (produccion ? '' : 'solo-desarrollo-no-usar');
  if (!secretoTokens) throw new Error('TOKEN_SECRET es obligatorio en producción');
  const databaseUrl = env.DATABASE_URL || undefined;
  if (produccion && !databaseUrl) throw new Error('DATABASE_URL es obligatorio en producción');

  const proveedorSms = (env.SMS_PROVIDER ?? 'simulado') as SmsConfig['proveedor'];
  if (!['simulado', 'twilio'].includes(proveedorSms)) throw new Error(`SMS_PROVIDER desconocido: ${proveedorSms}`);
  if (produccion && proveedorSms === 'simulado') throw new Error('En producción configura un proveedor de SMS real (SMS_PROVIDER)');
  const twilio = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
    ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, remitente: env.TWILIO_FROM }
    : undefined;

  return {
    puerto: Number(env.PORT ?? 3000),
    produccion,
    secretoTokens,
    urlPublica: env.PUBLIC_URL ?? 'http://localhost:3000',
    otpDesarrollo: produccion ? '' : env.OTP_DEV ?? '000000',
    cads: env.CADS_JSON ? (JSON.parse(env.CADS_JSON) as Record<string, CadConfig>) : {},
    esperaAcuseSeg: Number(env.CAD_ACK_TIMEOUT_SEC ?? 30),
    maxReportesPorHora: Number(env.MAX_REPORTS_PER_HOUR ?? 5),
    despachoActivo: env.CAD_DISPATCH !== 'off',
    databaseUrl,
    migrarAlIniciar: env.DB_MIGRATE !== 'off',
    sms: { proveedor: proveedorSms, twilio, avisos: env.SMS_NOTIFICATIONS !== 'off' },
    protocoloArchivo: env.PROTOCOLO_ARCHIVO || undefined,
  };
}

export const CONFIG = Symbol('CONFIG');
