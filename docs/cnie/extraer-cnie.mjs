#!/usr/bin/env node
/**
 * Genera packages/shared/src/cnie-v3.ts a partir del PDF oficial del CNIE V 3.0.
 *
 * Uso (requiere poppler-utils):
 *   pdftotext -layout docs/cnie/CNIE_V_3.0_Oficial_junio_24.pdf /tmp/cnie.txt
 *   node docs/cnie/extraer-cnie.mjs /tmp/cnie.txt packages/shared/src/cnie-v3.ts
 *
 * El texto sale de las tablas del capítulo 4 ("Clasificador del Catálogo").
 * Las únicas intervenciones manuales están en CORRECCIONES y cada una dice en
 * qué página del PDF se comprobó. Si una versión nueva del catálogo cambia el
 * formato, el script se detiene en las comprobaciones del final en lugar de
 * generar un archivo incompleto.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , entrada, salida] = process.argv;
if (!entrada || !salida) {
  console.error('Uso: node extraer-cnie.mjs <cnie.txt> <salida.ts>');
  process.exit(1);
}

/** Tipos (índice del PDF, p. 5) y subtipos (encabezado de cada tabla del capítulo 4). */
const TIPOS = [
  ['1', 'Médicos'],
  ['2', 'Protección Civil'],
  ['3', 'Seguridad'],
  ['4', 'Servicios Públicos'],
  ['5', 'Asistencia'],
  ['6', 'Otros Servicios'],
  ['7', 'Mal Uso del servicio (Improcedentes)'],
];
// [código, nombre oficial, nombre corto para pantalla, vigente]
const SUBTIPOS = [
  ['101', 'Accidente', 'Accidente', true],
  ['102', 'Traumáticos', 'Traumáticos', true],
  ['103', 'Clínico', 'Clínico', true],
  ['201', 'Auxilio', 'Auxilio', true],
  ['202', 'Medio Ambiente', 'Medio ambiente', true],
  ['203', 'Incendio', 'Incendio', true],
  ['204', 'Rescate', 'Rescate', true],
  ['301', 'Abandono', 'Abandono', true],
  ['302', 'Actos relacionados con armas/explosivos', 'Armas y explosivos', true],
  ['303', 'Actos relacionados con las vías de comunicación', 'Vías de comunicación', true],
  ['304', 'Actos relacionados con el patrimonio', 'Patrimonio', true],
  ['305', 'Actos relacionados con la familia', 'Familia', true],
  ['306', 'Actos relacionados con la libertad personal', 'Libertad personal', true],
  ['307', 'Actos relacionados con la libertad y seguridad sexual', 'Libertad y seguridad sexual', true],
  ['308', 'Actos relacionados con la seguridad colectiva', 'Seguridad colectiva', true],
  ['309', 'Actos relacionados con la vida y la integridad personal', 'Vida e integridad personal', true],
  ['310', 'Actos relacionados con otros bienes jurídicos', 'Otros bienes jurídicos', true],
  ['311', 'Disturbios y alteración al orden público', 'Disturbios y orden público', true],
  ['312', 'Notificación de hallazgo', 'Notificación de hallazgo', true],
  ['401', 'Infraestructura', 'Infraestructura', true],
  ['501', 'Protección', 'Protección', true],
  // p. 67: "502 Subtipo Notificación de hallazgo: BAJA. Se crea el numeral 312".
  ['502', 'Notificación de hallazgo', 'Notificación de hallazgo', false],
  ['503', 'Apoyo', 'Apoyo', true],
  ['601', 'Otros servicios públicos', 'Otros servicios públicos', true],
  ['602', 'Gestión de llamadas', 'Gestión de llamadas', true],
  ['701', 'Llamadas de mal uso del servicio', 'Mal uso del servicio', true],
];

/**
 * Correcciones a la extracción de texto, comprobadas a ojo contra el PDF.
 * Solo corrigen cómo se leyó el texto; ningún código ni prioridad se cambia.
 */
const CORRECCIONES = {
  // p. 27: el guion es parte del nombre ("INFECTO-" / "CONTAGIOSO").
  10120: 'ACCIDENTES CON RIESGO BIOLÓGICO INFECTO-CONTAGIOSO',
  // p. 40 y p. 19 ("Contingencia Humano-Cocodrilianos").
  20406: 'CONTINGENCIA HUMANO-COCODRILIANOS',
  // p. 36: punto final dentro de la celda.
  20114: 'TRANSPORTE NEGLIGENTE O CLANDESTINO DE SUSTANCIAS PELIGROSAS',
  // p. 70-71: la columna del nombre es angosta y el texto se mezcla con la descripción.
  70101: 'LLAMADA DE BROMA POR PERSONAS MENORES DE EDAD',
  70104: 'LLAMADA MUDA',
  70106: 'LLAMADAS CON PALABRAS OBSCENAS Y/O INSULTOS POR PERSONAS ADULTAS',
  70107: 'LLAMADA DE BROMA POR PERSONAS ADULTAS / JÓVENES',
  70109: 'LLAMADAS COLGADAS',
};
/** Prioridades que la extracción no alcanza a leer (p. 70-71). */
const PRIORIDADES_MANUALES = { 70104: 'BAJA', 70106: 'BAJA', 70109: 'BAJA' };

const lineas = readFileSync(entrada, 'utf8').normalize('NFC').replace(/\f/g, '\n').split('\n');
const inicio = lineas.findIndex((l, i) => i > 500 && /^4\. Clasificador/.test(l.trim()));
const fin = lineas.findIndex((l, i) => i > inicio && /^Fuentes de Consulta/.test(l.trim()));
if (inicio < 0 || fin < 0) throw new Error('No se encontró el capítulo 4 del catálogo');

const trozos = (l) => [...l.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ c: m.index, t: m[0] }));
const PRIO = /^(ALTA|MEDIA|BAJA)$/;
const filas = [];
let f = null;
for (const l of lineas.slice(inicio, fin)) {
  const m = /^(\s*)(\d{5})(\s+)(\S.*)$/.exec(l);
  if (/^\s*\d{3}\s+Subtipo/i.test(l)) { if (f) filas.push(f); f = null; continue; }
  if (m) {
    if (f) filas.push(f);
    const t = trozos(l.replace(m[2], ' '.repeat(5)));
    f = { codigo: m[2], colNombre: t[0].c, colDesc: t[1]?.c ?? null, nombre: [t[0].t], desc: t.slice(1).filter((x) => !PRIO.test(x.t)).map((x) => x.t), prioridad: null };
    const fin = /\s(ALTA|MEDIA|BAJA)\s*$/.exec(l);
    if (fin && t.length > 2) f.prioridad = fin[1];
    continue;
  }
  if (!f || /^\s*\d{1,2}\s*$/.test(l) || !l.trim()) continue;
  for (const x of trozos(l)) {
    if (PRIO.test(x.t) && x.c > (f.colDesc ?? 40) + 20) { f.prioridad ??= x.t; continue; }
    if (f.colDesc == null && x.c > f.colNombre + 5) { f.colDesc = x.c; f.desc.push(x.t); continue; }
    if (x.c < (f.colDesc ?? 999) - 1 && x.c >= f.colNombre - 3) f.nombre.push(x.t);
    else f.desc.push(x.t);
  }
}
if (f) filas.push(f);

const unir = (partes) => partes.reduce((s, p) => (s ? (/-$/.test(s) ? s.slice(0, -1) + p : `${s} ${p}`) : p), '').replace(/\s+/g, ' ').trim();

const activos = [];
const retirados = [];
for (const x of filas) {
  const nombre = CORRECCIONES[x.codigo] ?? unir(x.nombre);
  if (nombre === 'BAJA') {
    const texto = unir(x.desc);
    const reemplazo = /(?:número|servicio)\s+(\d{5})/.exec(texto)?.[1] ?? null;
    retirados.push({ codigo: x.codigo, motivo: texto, reemplazo });
    continue;
  }
  const prioridad = x.prioridad ?? PRIORIDADES_MANUALES[x.codigo];
  if (!prioridad) throw new Error(`Sin prioridad: ${x.codigo}`);
  activos.push({ codigo: x.codigo, nombre, prioridad });
}

// --- Comprobaciones contra lo que declara el propio PDF ---
// p. 9: "esta nueva versión se amplía a 361" incidentes.
if (activos.length !== 361) throw new Error(`Se esperaban 361 incidentes vigentes y salieron ${activos.length}`);
// p. 21-22 ("Dados de Baja" y "Cambio de Numeral") más 60102 (p. 68).
if (retirados.length !== 12) throw new Error(`Se esperaban 12 códigos retirados y salieron ${retirados.length}`);
const subtipos = new Set(SUBTIPOS.filter((s) => s[3]).map((s) => s[0]));
const vistos = new Set();
for (const a of activos) {
  if (!/^\d{5}$/.test(a.codigo)) throw new Error(`Código inválido ${a.codigo}`);
  if (!subtipos.has(a.codigo.slice(0, 3))) throw new Error(`${a.codigo} no pertenece a un subtipo vigente`);
  if (vistos.has(a.codigo)) throw new Error(`Código repetido ${a.codigo}`);
  if (/[a-z]{3}/.test(a.nombre)) throw new Error(`Nombre con texto de la descripción: ${a.codigo} ${a.nombre}`);
  vistos.add(a.codigo);
}
for (const r of retirados) if (r.reemplazo && !vistos.has(r.reemplazo)) throw new Error(`Reemplazo ${r.reemplazo} de ${r.codigo} no existe`);

const js = (v) => JSON.stringify(v);
const salidaTs = `/**
 * Catálogo Nacional de Incidentes de Emergencia (CNIE) V 3.0, oficial, junio 2024.
 * Secretariado Ejecutivo del Sistema Nacional de Seguridad Pública, Centro Nacional de Información.
 *
 * ARCHIVO GENERADO por docs/cnie/extraer-cnie.mjs desde docs/cnie/CNIE_V_3.0_Oficial_junio_24.pdf.
 * No se edita a mano: si cambia el catálogo, se agrega el PDF nuevo y se vuelve a generar.
 * Los nombres van tal como están en el PDF, incluida su ortografía
 * (por ejemplo 10114 "LESIONADA(S" sin paréntesis de cierre, p. 26).
 *
 * ${activos.length} incidentes vigentes y ${retirados.length} códigos retirados (dados de baja o cambiados de numeral).
 */
import type { PrioridadCnie } from './cnie';

export const CNIE_V3 = {
  version: '3.0',
  publicado: '2024-06',
  titulo: 'Catálogo Nacional de Incidentes de Emergencia V 3.0',
  emisor: 'Secretariado Ejecutivo del Sistema Nacional de Seguridad Pública (SESNSP), Centro Nacional de Información',
  archivo: 'docs/cnie/CNIE_V_3.0_Oficial_junio_24.pdf',
  tipos: [
${TIPOS.map(([c, n]) => `    { codigo: ${js(c)}, nombre: ${js(n)} },`).join('\n')}
  ],
  subtipos: [
${SUBTIPOS.map(([c, n, corto, v]) => `    { codigo: ${js(c)}, nombre: ${js(n)}, nombreCorto: ${js(corto)}, vigente: ${v} },`).join('\n')}
  ],
  /** [código, nombre, prioridad CNIE]. */
  incidentes: [
${activos.map((a) => `    [${js(a.codigo)}, ${js(a.nombre)}, ${js(a.prioridad)}],`).join('\n')}
  ] as [string, string, PrioridadCnie][],
  /** No se ofrecen como opción ni se aceptan en la API. */
  retirados: [
${retirados.map((r) => `    { codigo: ${js(r.codigo)}, motivo: ${js(r.motivo)}, reemplazo: ${js(r.reemplazo)} },`).join('\n')}
  ],
} as const;
`;
writeFileSync(salida, salidaTs);
console.log(`OK: ${activos.length} vigentes, ${retirados.length} retirados -> ${salida}`);
