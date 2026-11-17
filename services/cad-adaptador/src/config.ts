/**
 * Configuración del adaptador. El mismo código sirve para las dos formas de despliegue:
 *
 * - **Alojado por POL-IAQ** (multi-municipio): `ADAPTADOR_TENANTS_JSON` con un objeto por CAD.
 * - **Instalado en el municipio** (un solo CAD): `CAD_ID`, `POLIAQ_SECRETO`, `CAD_URL`, etc.
 *
 * Ver docs/interconexion/ADAPTADOR.md. El adaptador no guarda datos personales: solo ids de
 * eventos ya entregados, la última secuencia por folio y qué unidad atiende qué folio.
 */
import { readFileSync } from 'node:fs';
import { CAD_IDS } from '@pol-iaq/shared';

export interface Tenant {
  cadId: string;
  /** Secreto HMAC compartido con POL-IAQ (el mismo del alta del CAD). */
  secreto: string;
  /** Base del API del CAD (formato nativo): recibe POST /incidentes y /incidentes/:folio/actualizaciones. */
  cadUrl: string;
  /** Token con el que el adaptador llama al CAD (Authorization: Bearer). Opcional. */
  tokenHaciaCad?: string;
  /** Token que el CAD presenta al adaptador al mandar sus eventos. Obligatorio. */
  tokenDesdeCad: string;
}

export interface ConfigAdaptador {
  puerto: number;
  /** URL de POL-IAQ (p. ej. https://api.poliaq.example). */
  polIaqUrl: string;
  tenants: Record<string, Tenant>;
  /** `alojado` acepta rutas con :cadId; `instalado` atiende también las rutas sin él. */
  despliegue: 'alojado' | 'instalado';
  /** Esperas entre reintentos hacia POL-IAQ (ms). */
  reintentosMs: number[];
  /** Cada cuánto se manda el lote de AVL (ms). */
  avlCadaMs: number;
  /** Tiempo máximo de cada llamada (ms). */
  tiempoMaxMs: number;
  /** Certificado de cliente para mTLS hacia POL-IAQ (PEM), si POL-IAQ lo exige. */
  mtls?: { cert: string; key: string; ca?: string };
}

const leer = (ruta?: string) => (ruta ? readFileSync(ruta, 'utf8') : undefined);

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): ConfigAdaptador {
  let tenants: Record<string, Tenant>;
  let despliegue: ConfigAdaptador['despliegue'];
  if (env.ADAPTADOR_TENANTS_JSON) {
    despliegue = 'alojado';
    const crudo = JSON.parse(env.ADAPTADOR_TENANTS_JSON) as Record<string, Omit<Tenant, 'cadId'>>;
    tenants = Object.fromEntries(Object.entries(crudo).map(([cadId, t]) => [cadId, { cadId, ...t }]));
  } else {
    despliegue = 'instalado';
    const cadId = env.CAD_ID ?? '';
    if (!cadId || !env.POLIAQ_SECRETO || !env.CAD_URL || !env.CAD_TOKEN_ENTRADA) {
      throw new Error('Instalado en el municipio: define CAD_ID, POLIAQ_SECRETO, CAD_URL y CAD_TOKEN_ENTRADA (o ADAPTADOR_TENANTS_JSON si es alojado).');
    }
    tenants = { [cadId]: { cadId, secreto: env.POLIAQ_SECRETO, cadUrl: env.CAD_URL, tokenHaciaCad: env.CAD_TOKEN_SALIDA || undefined, tokenDesdeCad: env.CAD_TOKEN_ENTRADA } };
  }
  for (const t of Object.values(tenants)) {
    if (!CAD_IDS.includes(t.cadId)) throw new Error(`cadId desconocido: ${t.cadId}`);
    if (!t.secreto || t.secreto.length < 16) throw new Error(`${t.cadId}: secreto HMAC muy corto`);
    if (!t.tokenDesdeCad) throw new Error(`${t.cadId}: falta tokenDesdeCad`);
  }
  const cert = leer(env.POLIAQ_MTLS_CERT);
  const key = leer(env.POLIAQ_MTLS_KEY);
  return {
    puerto: Number(env.PORT ?? 4100),
    polIaqUrl: (env.POLIAQ_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    tenants,
    despliegue,
    reintentosMs: (env.REINTENTOS_MS ?? '0,1000,2000,4000,8000,16000').split(',').map(Number),
    avlCadaMs: Number(env.AVL_CADA_MS ?? 5000),
    tiempoMaxMs: Number(env.TIEMPO_MAX_MS ?? 5000),
    ...(cert && key && { mtls: { cert, key, ca: leer(env.POLIAQ_MTLS_CA) } }),
  };
}
