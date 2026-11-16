/**
 * Interconexión de los CAD municipales con POL-IAQ (contrato v1).
 *
 * - **Modo A (con CAD):** el municipio conecta su CAD por API (webhook firmado en ambos sentidos),
 *   directamente o con el adaptador de referencia (`services/cad-adaptador`).
 * - **Modo B (sin CAD):** el municipio despacha desde la consola de POL-IAQ, que es su CAD.
 *
 * Los dos modos usan los mismos folios, la misma clasificación CNIE y el mismo historial, así que un
 * municipio puede pasar de B a A sin perder nada (ver docs/interconexion/ALTA-MUNICIPIO.md).
 */
import { z } from 'zod';
import { CAD_ESTATAL_ID, CAD_IDS, municipioPorCad } from './municipios';

export type ModoCad = 'webhook' | 'consola';
/** `pruebas`: solo recibe reportes en el ambiente de pruebas. `activo`: producción. `suspendido`: sus reportes van al C5. */
export type EstadoCad = 'pruebas' | 'activo' | 'suspendido';

/** Casos de prueba obligatorios antes de pasar un CAD a producción (Modo A). */
export const CASOS_PRUEBA_CAD = [
  { id: 'acuse', nombre: 'Acuse (incidente.recibido) antes del tiempo límite' },
  { id: 'asignacion', nombre: 'Asignación de unidad (unidad.asignada)' },
  { id: 'gps', nombre: 'Posición GPS de la unidad (unidad.posicion y AVL en lote)' },
  { id: 'cierre', nombre: 'Llegada y cierre (incidente.estado en_sitio y cerrado)' },
  { id: 'reclasificacion', nombre: 'Corrección del código CNIE (incidente.reclasificado)' },
  { id: 'transferencia', nombre: 'Transferencia a otro municipio (incidente.transferido)' },
  { id: 'reintentos', nombre: 'Caída del webhook y entrega con reintentos' },
  { id: 'duplicado', nombre: 'Evento duplicado (mismo eventoId) sin efecto doble' },
] as const;
export type CasoPruebaCad = (typeof CASOS_PRUEBA_CAD)[number]['id'];

export interface ResultadoCaso {
  ok: boolean;
  en: string;
  detalle?: string;
}

export interface ContactoTecnico {
  nombre: string;
  correo: string;
  telefono?: string;
}

/** Tipos de unidad que registra un municipio (Modo B) o que reporta su CAD (Modo A). */
export const TIPOS_UNIDAD = [
  { id: 'patrulla', nombre: 'Patrulla' },
  { id: 'motopatrulla', nombre: 'Motopatrulla' },
  { id: 'ambulancia', nombre: 'Ambulancia' },
  { id: 'bomberos', nombre: 'Bomberos' },
] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number]['id'];

export const CORPORACIONES = [
  { id: 'policia_municipal', nombre: 'Policía municipal' },
  { id: 'policia_estatal', nombre: 'Policía estatal' },
  { id: 'cruz_roja', nombre: 'Cruz Roja' },
  { id: 'bomberos', nombre: 'Bomberos' },
  { id: 'proteccion_civil', nombre: 'Protección Civil' },
] as const;

/** Tipo de unidad a partir de su clave o etiqueta, para unidades registradas antes de que existiera el campo. */
export function tipoUnidadDe(u: { tipo?: string; unidadId: string; etiqueta: string; corporacion: string }): TipoUnidad {
  if (u.tipo && TIPOS_UNIDAD.some((t) => t.id === u.tipo)) return u.tipo as TipoUnidad;
  const e = `${u.etiqueta} ${u.unidadId}`.toLowerCase();
  if (/moto/.test(e)) return 'motopatrulla';
  if (/ambulancia/.test(e) || u.corporacion === 'cruz_roja') return 'ambulancia';
  if (/bomber/.test(e) || u.corporacion === 'bomberos') return 'bomberos';
  return 'patrulla';
}

const Coordenada = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** IPv4 o IPv6, con o sin prefijo CIDR. */
const Ip = z.string().regex(/^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)(?:\/\d{1,3})?$/, 'IP o rango CIDR inválido');

/** Alta o cambio de un CAD (onboarding). El secreto nunca se devuelve una vez guardado. */
export const AltaCadSchema = z.object({
  cadId: z.string().refine((x) => CAD_IDS.includes(x), 'cadId desconocido: debe ser uno de los 18 municipios o el C5'),
  nombre: z.string().trim().min(3).max(120),
  /** Clave INEGI de 5 dígitos del municipio (22001–22018). El C5 no lleva clave. */
  clave: z.string().regex(/^22\d{3}$/).nullable(),
  modo: z.enum(['webhook', 'consola']),
  /** Sin polígono se usa el de INEGI 2022 del municipio. */
  poligono: z.array(Coordenada).min(4).max(5000).optional(),
  webhookUrl: z.url().optional(),
  /** Secreto compartido para la firma HMAC-SHA256 (mínimo 32 caracteres). */
  secreto: z.string().min(32).max(200).optional(),
  /** Huella SHA-256 (hex, con o sin ":") del certificado de cliente del CAD para mTLS. */
  certificadoSha256: z.string().regex(/^(?:[0-9a-fA-F]{2}:?){31}[0-9a-fA-F]{2}$/).optional(),
  ipsPermitidas: z.array(Ip).max(50).default([]),
  contactoTecnico: z.object({ nombre: z.string().trim().min(3).max(120), correo: z.email(), telefono: z.string().regex(/^\+?\d{10,13}$/).optional() }),
}).superRefine((x, ctx) => {
  const esperada = x.cadId === CAD_ESTATAL_ID ? null : municipioPorCad(x.cadId)?.clave ?? null;
  if (x.clave !== esperada) ctx.addIssue({ code: 'custom', path: ['clave'], message: `La clave de ${x.cadId} es ${esperada ?? 'null (C5)'}` });
  if (x.modo === 'webhook' && !x.webhookUrl) ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'Modo A (webhook) requiere webhookUrl' });
});
export type AltaCad = z.infer<typeof AltaCadSchema>;

/** Normaliza una huella "AB:CD:…" o "abcd…" a hex en minúsculas sin separadores. */
export const normalizarHuella = (h: string) => h.replace(/:/g, '').toLowerCase();

/** ¿La IP está en la lista (IPv4 con CIDR; IPv6 por coincidencia exacta)? Lista vacía = cualquiera. */
export function ipPermitida(ip: string, lista: readonly string[]): boolean {
  if (!lista.length) return true;
  const limpia = ip.replace(/^::ffff:/, '');
  const aNum = (x: string) => x.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  return lista.some((r) => {
    const [base, bits] = r.split('/');
    if (!base.includes('.') || !limpia.includes('.')) return base.toLowerCase() === limpia.toLowerCase();
    const b = bits === undefined ? 32 : Number(bits);
    const mascara = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
    return (aNum(base) & mascara) === (aNum(limpia) & mascara);
  });
}

/** ¿Faltan casos obligatorios para pasar a producción? Devuelve los que faltan o fallaron. */
export function casosPendientes(resultados: Partial<Record<CasoPruebaCad, ResultadoCaso>> | undefined): CasoPruebaCad[] {
  return CASOS_PRUEBA_CAD.map((c) => c.id).filter((id) => !resultados?.[id]?.ok);
}
