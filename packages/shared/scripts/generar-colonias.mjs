#!/usr/bin/env node
/**
 * Genera packages/shared/src/colonias-qro.ts a partir del seed packages/shared/datos/colonias-queretaro-sepomex.json
 * (Catálogo Nacional de Códigos Postales de SEPOMEX, solo Querétaro).
 *
 *   node packages/shared/scripts/generar-colonias.mjs
 *
 * Valida el seed (18 claves INEGI 22001–22018, CP de 5 dígitos, nombre presente) y escribe una tabla compacta con
 * un identificador estable por asentamiento. El seed se versiona tal cual, con su encabezado de atribución.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaSeed = join(raiz, 'datos', 'colonias-queretaro-sepomex.json');
const rutaSalida = join(raiz, 'src', 'colonias-qro.ts');

const bytes = readFileSync(rutaSeed);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const seed = JSON.parse(bytes.toString('utf8'));

const CLAVES = Array.from({ length: 18 }, (_, i) => `220${String(i + 1).padStart(2, '0')}`);
const errores = [];
if (!Array.isArray(seed.colonias)) errores.push('El seed no tiene la lista «colonias».');
if (seed.total_asentamientos !== seed.colonias?.length) errores.push(`total_asentamientos (${seed.total_asentamientos}) no coincide con la lista (${seed.colonias?.length}).`);
for (const [i, c] of (seed.colonias ?? []).entries()) {
  if (!/^\d{5}$/.test(c.cp ?? '')) errores.push(`#${i}: CP inválido «${c.cp}»`);
  if (!CLAVES.includes(c.municipioClave)) errores.push(`#${i}: clave de municipio fuera de Querétaro «${c.municipioClave}»`);
  if (!String(c.colonia ?? '').trim()) errores.push(`#${i}: sin nombre`);
  if (c.zona !== 'Urbano' && c.zona !== 'Rural') errores.push(`#${i}: zona desconocida «${c.zona}»`);
}
const presentes = new Set((seed.colonias ?? []).map((c) => c.municipioClave));
for (const k of CLAVES) if (!presentes.has(k)) errores.push(`Falta el municipio ${k}.`);
if (errores.length) {
  console.error(errores.slice(0, 20).join('\n'));
  process.exit(1);
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tipos = [...new Set(seed.colonias.map((c) => c.tipo))].sort((a, b) => a.localeCompare(b, 'es'));

// Identificador estable: CP + nombre; si el nombre se repite en el mismo CP (distinto tipo), se agrega el tipo.
const vistos = new Map();
const filas = seed.colonias.map((c) => {
  let id = `${c.cp}-${slug(c.colonia)}`;
  if (vistos.has(id)) id = `${id}-${slug(c.tipo)}`;
  let n = 2;
  const base = id;
  while (vistos.has(id)) id = `${base}-${n++}`;
  vistos.set(id, true);
  return [id, c.cp, c.colonia.trim(), tipos.indexOf(c.tipo), c.municipioClave.slice(2), c.zona === 'Urbano' ? 'U' : 'R'];
});

const js = (x) => JSON.stringify(x);
const salida = `/**
 * GENERADO por packages/shared/scripts/generar-colonias.mjs. No editar a mano.
 *
 * Colonias y demás asentamientos de los 18 municipios de Querétaro con su código postal, tipo y zona.
 * Fuente: ${seed.fuente}.
 * Descargado el ${seed.fecha_descarga}. ${seed.alcance}.
 * Licencia: ${seed.licencia_nota}
 * Seed: packages/shared/datos/colonias-queretaro-sepomex.json, SHA-256 ${sha256}.
 */
export const FUENTE_COLONIAS = ${js({ fuente: seed.fuente, enlace: 'https://postali.app/mx', fechaDescarga: seed.fecha_descarga, licencia: seed.licencia_nota, alcance: seed.alcance, total: filas.length, sha256 })} as const;

export const TIPOS_ASENTAMIENTO: readonly string[] = ${js(tipos)};

/** [id, cp, nombre, índice en TIPOS_ASENTAMIENTO, municipio (3 dígitos de la clave INEGI, sin el 22), zona U/R]. */
export const COLONIAS_QRO_TABLA: readonly (readonly [string, string, string, number, string, 'U' | 'R'])[] = [
${filas.map((f) => `  ${js(f)},`).join('\n')}
];
`;
writeFileSync(rutaSalida, salida);
console.log(`${filas.length} asentamientos de ${presentes.size} municipios → ${rutaSalida}`);
