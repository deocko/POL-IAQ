import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Configuración por variables de entorno. Ver .env.example.
 */
export interface CadConfig {
  /**
   * `webhook` (por defecto): el CAD municipal recibe los eventos en su propio sistema.
   * `consola`: el municipio no tiene CAD integrado y despacha desde la consola web de Pol-IAQ.
   */
  modo?: 'webhook' | 'consola';
  /** URL a la que Pol-IAQ envía eventos (webhook del adaptador del CAD). No aplica en modo consola. */
  webhookUrl?: string;
  /** Secreto compartido para firmar en ambos sentidos (HMAC-SHA256). */
  secreto?: string;
}

/** Operador de la consola web. TODO(fase 1): SSO (OIDC) con segundo factor. */
export interface OperadorConfig {
  usuario: string;
  nombre: string;
  /** CAD que puede ver y operar; `*` = todos (supervisión). */
  cadIds: string[];
  /** `scrypt:<sal hex>:<hash hex>`; generar con `pnpm --filter @pol-iaq/api hash-clave`. */
  claveHash: string;
}

/** Unidad que se puede asignar desde la consola. TODO(fase 2): vendrá de la App Unidad / el padrón del municipio. */
export interface UnidadConfig {
  unidadId: string;
  cadId: string;
  corporacion: string;
  etiqueta: string;
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
  operadores: OperadorConfig[];
  unidades: UnidadConfig[];
}

/** Hash de una clave de operador (scrypt). */
export function hashClave(clave: string, sal = randomBytes(16)): string {
  return `scrypt:${sal.toString('hex')}:${scryptSync(clave, sal, 32).toString('hex')}`;
}

export function claveValida(clave: string, guardado: string): boolean {
  const [alg, sal, hash] = guardado.split(':');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const calc = scryptSync(clave, Buffer.from(sal, 'hex'), 32);
  const esperado = Buffer.from(hash, 'hex');
  return calc.length === esperado.length && timingSafeEqual(calc, esperado);
}

/** Unidades de ejemplo para desarrollo y demos (no son unidades reales). */
export const UNIDADES_DESARROLLO: UnidadConfig[] = [
  ...['cad-queretaro', 'cad-corregidora', 'cad-el-marques', 'c5-queretaro'].flatMap((cadId, i) => [
    { unidadId: `P-${i + 1}01`, cadId, corporacion: cadId === 'c5-queretaro' ? 'policia_estatal' : 'policia_municipal', etiqueta: `Patrulla ${i + 1}01` },
    { unidadId: `P-${i + 1}02`, cadId, corporacion: cadId === 'c5-queretaro' ? 'policia_estatal' : 'policia_municipal', etiqueta: `Patrulla ${i + 1}02` },
    { unidadId: `A-${i + 1}10`, cadId, corporacion: 'cruz_roja', etiqueta: `Ambulancia ${i + 1}10` },
    { unidadId: `B-${i + 1}20`, cadId, corporacion: 'bomberos', etiqueta: `Unidad de bomberos ${i + 1}20` },
  ]),
];

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

  const cads = env.CADS_JSON ? (JSON.parse(env.CADS_JSON) as Record<string, CadConfig>) : {};
  // CONSOLA_CADS=cad-queretaro,c5-queretaro: esos CAD despachan desde la consola web.
  for (const id of (env.CONSOLA_CADS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) cads[id] = { ...cads[id], modo: 'consola' };

  const operadores: OperadorConfig[] = env.OPERADORES_JSON ? JSON.parse(env.OPERADORES_JSON) : [];
  if (!operadores.length && !produccion) {
    // Solo desarrollo: usuario "operador", clave "operador", todos los CAD.
    operadores.push({ usuario: 'operador', nombre: 'Operador de pruebas', cadIds: ['*'], claveHash: hashClave('operador') });
  }

  return {
    puerto: Number(env.PORT ?? 3000),
    produccion,
    secretoTokens,
    urlPublica: env.PUBLIC_URL ?? 'http://localhost:3000',
    otpDesarrollo: produccion ? '' : env.OTP_DEV ?? '000000',
    cads,
    esperaAcuseSeg: Number(env.CAD_ACK_TIMEOUT_SEC ?? 30),
    maxReportesPorHora: Number(env.MAX_REPORTS_PER_HOUR ?? 5),
    despachoActivo: env.CAD_DISPATCH !== 'off',
    databaseUrl,
    migrarAlIniciar: env.DB_MIGRATE !== 'off',
    sms: { proveedor: proveedorSms, twilio, avisos: env.SMS_NOTIFICATIONS !== 'off' },
    protocoloArchivo: env.PROTOCOLO_ARCHIVO || undefined,
    operadores,
    unidades: env.UNIDADES_JSON ? (JSON.parse(env.UNIDADES_JSON) as UnidadConfig[]) : produccion ? [] : UNIDADES_DESARROLLO,
  };
}

export const CONFIG = Symbol('CONFIG');
