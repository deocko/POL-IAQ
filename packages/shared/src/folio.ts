import { CLAVE_ESTADO_QRO } from './municipios';

/**
 * Folio unificado: QRO-<clave municipio INEGI>-<año>-<consecutivo de 6 dígitos>.
 * Para reportes fuera de los municipios piloto se usa la clave "000" (estatal).
 * El folio nunca cambia, aunque el incidente se transfiera.
 */
export const FOLIO_REGEX = /^QRO-(\d{3})-(\d{4})-(\d{6})$/;
export const CLAVE_ESTATAL = '000';

export function generarFolio(claveMunicipio: string | null, anio: number, consecutivo: number): string {
  const clave = claveMunicipio ?? CLAVE_ESTATAL;
  if (!/^\d{3}$/.test(clave)) throw new Error(`Clave de municipio inválida: ${clave}`);
  if (!Number.isInteger(consecutivo) || consecutivo < 1 || consecutivo > 999_999) {
    throw new Error(`Consecutivo fuera de rango: ${consecutivo}`);
  }
  return `QRO-${clave}-${anio}-${String(consecutivo).padStart(6, '0')}`;
}

export function parsearFolio(folio: string): { claveMunicipio: string; anio: number; consecutivo: number } | null {
  const m = FOLIO_REGEX.exec(folio);
  if (!m) return null;
  return { claveMunicipio: m[1], anio: Number(m[2]), consecutivo: Number(m[3]) };
}

/** Referencia al estado, útil en integraciones con el C5. */
export const PREFIJO_ESTADO = { abreviatura: 'QRO', claveInegi: CLAVE_ESTADO_QRO } as const;
