/**
 * Textos sin espacio ("AtiendeCAD Querétaro", "hace2 min", "Foto(opcional)").
 *
 * En JSX, `Atiende {cad}` se convierte en dos nodos de texto ("Atiende " y "CAD …").
 * Los lectores de pantalla y muchas herramientas que extraen el texto recortan cada
 * nodo y los unen sin espacio. La regla: una frase visible va en UN solo texto
 * (`{`Atiende ${cad}`}`), y las piezas que deben ir separadas (chips, etiquetas)
 * van en contenedores `.c-linea` / `.d-linea`, que las separan con `gap`.
 *
 * Esta prueba revisa el código de la app ciudadana web, la consola y la portada.
 * La verificación en el navegador (Playwright) aplica la misma regla al DOM.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { textosPartidos } from './textos-partidos';

const ARCHIVOS = ['app/demo/page.tsx', 'app/consola/page.tsx', 'app/page.tsx', 'app/legal/[documento]/page.tsx', 'app/consola/bandeja.tsx', 'app/consola/alta911.tsx', 'app/consola/folios.tsx'];

describe('textos sin espacio', () => {
  it('detecta los casos de la verificación en vivo', () => {
    expect(textosPartidos('<span className="suave">Atiende {demo.nombreCad(r.cadId)} · {r.alias}</span>').length).toBeGreaterThan(0);
    expect(textosPartidos('<div className="suave c-pequeno">Confiabilidad {Math.round(r.reportante.confiabilidad * 100)}%</div>').length).toBeGreaterThan(0);
    expect(textosPartidos('<span>{duracion}</span> · meta de llegada {Math.round(t.metaSegundos / 60)} min').length).toBeGreaterThan(0);
    expect(textosPartidos('<h3>Sin reportes {todos ? \'\' : \'activos \'}por ahora</h3>').length).toBeGreaterThan(0);
    expect(textosPartidos('<span className="suave c-pequeno">{`Atiende ${cad} · ${alias}`}</span>')).toEqual([]);
    expect(textosPartidos('const x = a.map((b) => {')).toEqual([]);
  });

  for (const archivo of ARCHIVOS) {
    it(`${archivo}: cada frase visible va en un solo texto`, () => {
      const fuente = readFileSync(path.join(__dirname, '..', archivo), 'utf8');
      expect(textosPartidos(fuente)).toEqual([]);
    });
  }
});
