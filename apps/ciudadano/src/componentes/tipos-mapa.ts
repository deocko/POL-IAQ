export interface Punto {
  lat: number;
  lng: number;
}

export interface PropsMapa {
  /** Lugar del reporte. */
  reporte: Punto;
  /** Unidad asignada con su última posición conocida, si ya la hay. */
  unidad?: Punto & { etiqueta: string; rumbo?: number };
  /** Posiciones recientes de la unidad, de la más vieja a la más nueva. */
  recorrido: Punto[];
  alto?: number;
}
