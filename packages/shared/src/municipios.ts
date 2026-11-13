/**
 * Municipios piloto de Pol-IAQ.
 *
 * `claveInegi` es la clave de municipio del Marco Geoestadístico de INEGI
 * (estado 22 = Querétaro) y se usa dentro del folio unificado.
 *
 * IMPORTANTE: los polígonos `geocercaAproximada` son rectángulos burdos
 * SOLO para desarrollo. Antes del piloto deben reemplazarse por los
 * polígonos oficiales del Marco Geoestadístico de INEGI y validarse con
 * cada municipio y con el C5.
 */
export type Coordenada = [lng: number, lat: number];

export interface Municipio {
  claveInegi: string;
  nombre: string;
  piloto: boolean;
  /** Identificador del CAD que atiende este municipio (ver configuración del API). */
  cadId: string;
  geocercaAproximada: Coordenada[];
}

export const CLAVE_ESTADO_QRO = '22';

export const MUNICIPIOS_PILOTO: readonly Municipio[] = [
  {
    claveInegi: '014',
    nombre: 'Querétaro',
    piloto: true,
    cadId: 'cad-queretaro',
    geocercaAproximada: [
      [-100.6, 20.555],
      [-100.33, 20.555],
      [-100.33, 20.95],
      [-100.6, 20.95],
    ],
  },
  {
    claveInegi: '006',
    nombre: 'Corregidora',
    piloto: true,
    cadId: 'cad-corregidora',
    geocercaAproximada: [
      [-100.52, 20.38],
      [-100.33, 20.38],
      [-100.33, 20.555],
      [-100.52, 20.555],
    ],
  },
  {
    claveInegi: '011',
    nombre: 'El Marqués',
    piloto: true,
    cadId: 'cad-el-marques',
    geocercaAproximada: [
      [-100.33, 20.5],
      [-100.08, 20.5],
      [-100.08, 20.95],
      [-100.33, 20.95],
    ],
  },
];

/** CAD estatal (C5). Recibe todo lo que cae fuera de una geocerca piloto. */
export const CAD_ESTATAL_ID = 'c5-queretaro';

export function municipioPorClave(clave: string): Municipio | undefined {
  return MUNICIPIOS_PILOTO.find((m) => m.claveInegi === clave);
}
