/**
 * Máquina de estados del incidente, tal como la ve el ciudadano.
 */
export const ESTADOS = [
  'recibido',
  'validado',
  'asignado',
  'en_camino',
  'en_sitio',
  'cerrado',
  'improcedente',
  'transferido',
  'cancelado',
] as const;

export type EstadoIncidente = (typeof ESTADOS)[number];

export const ESTADOS_FINALES: readonly EstadoIncidente[] = ['cerrado', 'improcedente', 'cancelado'];

const TRANSICIONES: Record<EstadoIncidente, readonly EstadoIncidente[]> = {
  recibido: ['validado', 'improcedente', 'cancelado', 'transferido'],
  validado: ['asignado', 'improcedente', 'transferido', 'cancelado'],
  asignado: ['en_camino', 'transferido', 'cancelado'],
  en_camino: ['en_sitio', 'transferido', 'cancelado'],
  en_sitio: ['cerrado', 'transferido'],
  transferido: ['asignado', 'validado'],
  cerrado: [],
  improcedente: [],
  cancelado: [],
};

export function puedeTransicionar(desde: EstadoIncidente, hacia: EstadoIncidente): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export const ETIQUETAS_CIUDADANO: Record<EstadoIncidente, string> = {
  recibido: 'Recibimos tu reporte',
  validado: 'Un operador revisó tu reporte',
  asignado: 'Unidad asignada',
  en_camino: 'La unidad va en camino',
  en_sitio: 'La unidad llegó al lugar',
  cerrado: 'Reporte atendido',
  improcedente: 'Reporte no procedente',
  transferido: 'Canalizado a otra corporación',
  cancelado: 'Reporte cancelado',
};
