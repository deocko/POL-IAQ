#!/usr/bin/env node
/**
 * Genera packages/shared/src/municipios-qro.ts con los 18 municipios de Querétaro y su
 * polígono de jurisdicción simplificado.
 *
 * Fuente: Áreas geoestadísticas municipales del Marco Geoestadístico de INEGI 2022, en la
 * versión GeoJSON publicada por CONABIO (repositorio PhantomInsights/mexico-geojson,
 * archivo 2022/states/Querétaro.json, CRS84 = lng/lat WGS84). La clave CVE_MUN y el nombre
 * NOMGEO se copian tal cual. El polígono se simplifica (Douglas-Peucker, tolerancia
 * TOLERANCIA grados) para que la app lo lleve sin peso.
 *
 * Uso: node docs/municipios/extraer-geocercas.mjs <ruta a Querétaro.json>
 * Sin ruta, lo descarga de FUENTE_URL.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FUENTE_URL = 'https://raw.githubusercontent.com/PhantomInsights/mexico-geojson/main/2022/states/Quer%C3%A9taro.json';
const TOLERANCIA = 0.001; // ~100 m
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const texto = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(FUENTE_URL)).text();
const sha256 = createHash('sha256').update(texto).digest('hex');
const datos = JSON.parse(texto);
if (datos.crs?.properties?.name !== 'urn:ogc:def:crs:OGC:1.3:CRS84') throw new Error('Se esperaba CRS84 (lng/lat)');

function dp(puntos, tol) {
  if (puntos.length < 3) return puntos;
  const [a, b] = [puntos[0], puntos.at(-1)];
  let max = 0, idx = 0;
  for (let i = 1; i < puntos.length - 1; i++) {
    const [x, y] = puntos[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = dx === 0 && dy === 0 ? Math.hypot(x - a[0], y - a[1]) : Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return [...dp(puntos.slice(0, idx + 1), tol).slice(0, -1), ...dp(puntos.slice(idx), tol)];
}

const anillo = (g) => {
  // Se toma el anillo exterior más grande (los 18 municipios son un solo polígono en esta fuente).
  const polis = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  return polis.map((p) => p[0]).sort((x, y) => y.length - x.length)[0];
};

const filas = datos.features
  .map((f) => ({ clave: f.properties.CVE_MUN, ent: f.properties.CVE_ENT, nombre: f.properties.NOMGEO, puntos: anillo(f.geometry), tipo: f.geometry.type }))
  .sort((a, b) => a.clave.localeCompare(b.clave));
if (filas.length !== 18 || filas.some((f) => f.ent !== '22')) throw new Error(`Se esperaban 18 municipios de la entidad 22; llegaron ${filas.length}`);

const r = (n) => Math.round(n * 1e5) / 1e5;
const salida = `/**
 * GENERADO por docs/municipios/extraer-geocercas.mjs. No editar a mano.
 *
 * Los 18 municipios de Querétaro (entidad 22) con su clave INEGI (CVE_MUN) y su polígono de
 * jurisdicción simplificado (Douglas-Peucker, ${TOLERANCIA}° ≈ 100 m), en [lng, lat] WGS84.
 * Fuente: Marco Geoestadístico de INEGI 2022, versión GeoJSON de CONABIO
 * (${FUENTE_URL}), SHA-256 ${sha256}.
 * Antes de producción: validar cada polígono con su municipio y con el CQ CIAS.
 */
export const FUENTE_GEOCERCAS = { url: '${FUENTE_URL}', sha256: '${sha256}', marco: 'INEGI Marco Geoestadístico 2022 (vía CONABIO)', toleranciaGrados: ${TOLERANCIA} } as const;

export const MUNICIPIOS_QRO_INEGI: readonly { clave: string; nombre: string; poligono: readonly (readonly [number, number])[] }[] = [
${filas.map((f) => {
  const s = dp(f.puntos, TOLERANCIA);
  console.log(`${f.clave} ${f.nombre}: ${f.puntos.length} → ${s.length} puntos (${f.tipo})`);
  return `  { clave: '${f.clave}', nombre: '${f.nombre}', poligono: [${s.map(([x, y]) => `[${r(x)}, ${r(y)}]`).join(', ')}] },`;
}).join('\n')}
];
`;
writeFileSync(path.join(raiz, 'packages/shared/src/municipios-qro.ts'), salida);
console.log(`SHA-256 de la fuente: ${sha256}`);
