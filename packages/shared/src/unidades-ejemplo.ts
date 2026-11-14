/**
 * Unidades de EJEMPLO para desarrollo y la demo (no son unidades reales).
 * `base` es una posición inicial ficticia; en operación la posición llega por
 * GPS (AVL) del CAD o de la App Unidad.
 */
export interface UnidadEjemplo {
  unidadId: string;
  cadId: string;
  corporacion: string;
  etiqueta: string;
  base: { lat: number; lng: number };
}

const CENTROS: [cadId: string, lat: number, lng: number][] = [
  ['cad-queretaro', 20.5935, -100.392],
  ['cad-corregidora', 20.5415, -100.4435],
  ['cad-el-marques', 20.6125, -100.318],
  ['c5-queretaro', 20.47, -100.2],
];

/** Desplazamientos fijos alrededor del centro para que las unidades no estén encimadas. */
const DESPLAZAMIENTO: [number, number][] = [[0.012, -0.01], [-0.014, 0.008], [0.004, 0.016], [-0.006, -0.018]];

export const UNIDADES_EJEMPLO: UnidadEjemplo[] = CENTROS.flatMap(([cadId, lat, lng], i) => {
  const policia = cadId === 'c5-queretaro' ? 'policia_estatal' : 'policia_municipal';
  const tipos: [string, string, string][] = [
    [`P-${i + 1}01`, policia, `Patrulla ${i + 1}01`],
    [`P-${i + 1}02`, policia, `Patrulla ${i + 1}02`],
    [`A-${i + 1}10`, 'cruz_roja', `Ambulancia ${i + 1}10`],
    [`B-${i + 1}20`, 'bomberos', `Unidad de bomberos ${i + 1}20`],
  ];
  return tipos.map(([unidadId, corporacion, etiqueta], j) => ({
    unidadId, cadId, corporacion, etiqueta,
    base: { lat: +(lat + DESPLAZAMIENTO[j][0]).toFixed(5), lng: +(lng + DESPLAZAMIENTO[j][1]).toFixed(5) },
  }));
});
