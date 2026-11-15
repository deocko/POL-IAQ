/**
 * Prepara los borradores de docs/legal para publicarlos en la web: sin notas
 * internas, sin marcadores ni huecos "por definir". No inventa ningún dato:
 * cada dato que falta se omite (y la sección que queda vacía se quita); el aviso
 * de arriba de la página dice qué datos faltan, sin prometer ninguno. La lista cerrada de lo que debe entregar el
 * área jurídica (qué dato, dónde va y en qué formato) está en docs/legal/PENDIENTES-JURIDICO.md.
 */

/** Sustituciones exactas por documento: [texto del borrador, texto publicado]. */
const SUSTITUCIONES: Record<string, [string | RegExp, string][]> = {
  'aviso-privacidad': [
    [/^\[NOMBRE DEL RESPONSABLE[^\n]*$/m,
      'Este aviso explica cómo se tratan los datos personales que proporcionas al usar la aplicación y el sitio web POL-IAQ (en adelante, "POL-IAQ").'],
    [', [CURP, si se solicita]', ''],
    [' o escribe a [CORREO DE LA UNIDAD DE TRANSPARENCIA]', ''],
    // Sin el fundamento legal la sección 4 queda vacía: se quita y se renumera.
    [/^## 4\. Fundamento legal\n+\[COMPLETAR por el área jurídica: artículos aplicables[^\n]*\n+/m, ''],
    [' y [CONFIRMAR: no requieren tu consentimiento conforme a la ley aplicable]', ''],
    [' Los datos se alojan en [PAÍS/REGIÓN, de preferencia México].', ''],
    // Sin plazos numéricos no se publica la tabla de plazos: solo las reglas que no dependen de un número.
    [/^\| Dato \| Plazo propuesto \|\n[\s\S]*?\n(?=\n)/m,
      'Conservamos tus datos solo mientras sean necesarios para las finalidades de este aviso; después se eliminan o anonimizan. La evidencia vinculada a una carpeta de investigación se conserva el plazo que fije la autoridad o la ley aplicable. Al cancelar tu cuenta se elimina, salvo lo que deba conservarse por esas razones.\n'],
    [/^- \*\*Por escrito o en persona:\*\* Unidad de Transparencia de \[RESPONSABLE\][^\n]*\n/m, ''],
    [' [CONFIRMAR denominación vigente]', ''],
    ['Te responderemos en un plazo máximo de [20 días hábiles], conforme a la ley aplicable.', 'Te responderemos en el plazo que señala la ley aplicable.'],
    ['puedes acudir a [AUTORIDAD GARANTE COMPETENTE EN QUERÉTARO, CONFIRMAR TRAS LA REFORMA DE 2025].', 'puedes acudir a la autoridad garante en materia de protección de datos personales.'],
    [' [CONFIRMAR CON JURÍDICO: si se permitirá el registro de adolescentes con consentimiento de madre, padre o tutor.]', ''],
    ['está siempre en [URL] y en', 'está siempre en esta página y en'],
  ],
  terminos: [
    ['servicio digital gratuito de [RESPONSABLE] que', 'servicio digital gratuito que'],
    [' [CONFIRMAR política para adolescentes]', ''],
    ['conforme a [CITAR la disposición aplicable de la legislación del Estado de Querétaro o reglamento municipal].', 'conforme a la legislación aplicable.'],
    ['[RESPONSABLE] y las corporaciones atienden', 'Las autoridades y corporaciones atienden'],
    [' [REVISAR CON JURÍDICO el alcance de la limitación de responsabilidad aplicable a una autoridad pública.]', ''],
    [' y cómo inconformarte en [MEDIO].', ' y cómo inconformarte.'],
    ['se conserva por los plazos del Aviso de Privacidad.', 'se conserva conforme al Aviso de Privacidad.'],
    ['ante [AUTORIDADES O TRIBUNALES COMPETENTES EN SANTIAGO DE QUERÉTARO].', 'ante las autoridades competentes.'],
    // Sin datos de contacto la sección 13 queda vacía: se quita.
    [/^## 13\. Contacto\n+\[CORREO\] · \[TELÉFONO\] · \[DOMICILIO\]\n+/m, ''],
  ],
  'aviso-simplificado': [
    ['[RESPONSABLE] trata tu nombre', 'Tratamos tu nombre'],
    ['está en [aviso-privacidad.md](aviso-privacidad.md) y los términos en [terminos.md](terminos.md).', 'está en el [Aviso de Privacidad Integral](aviso-privacidad.md) y los términos, en [Términos y Condiciones](terminos.md).'],
    ['Consulta el aviso integral en [URL].', 'Consulta el [Aviso de Privacidad Integral](aviso-privacidad.md).'],
  ],
};

/** Qué datos faltan en cada documento: lo dice el aviso de arriba de la página, sin prometer ninguno. */
export const FALTAN: Record<string, string> = {
  'aviso-privacidad': 'la identidad y el domicilio del responsable, el fundamento legal, el país donde se alojan los datos, los plazos de conservación, los datos de contacto y el horario de la Unidad de Transparencia, el plazo de respuesta a una solicitud ARCO ni la autoridad garante ante la que puedes presentar una queja',
  terminos: 'la identidad del responsable, la disposición que sanciona las falsas alarmas, el medio para inconformarte por una suspensión, las autoridades competentes ni los datos de contacto',
  'aviso-simplificado': 'la identidad del responsable ni la dirección oficial del aviso integral',
};

/** Un marcador es un texto entre corchetes que no es un enlace Markdown. */
export const MARCADOR = /\[[^\]\n]+\](?!\()/;

export function paraPublicar(md: string, documento: string, base = ''): string {
  let s = md
    // Notas para el equipo (blockquotes "> Nota para el equipo …").
    .replace(/^> Nota para el equipo[^\n]*\n?/gim, '')
    .replace('Este archivo reúne los textos cortos que aparecen en la app. ', 'Textos cortos que aparecen en la app. ')
    // El estado de borrador se muestra como un aviso general limpio arriba de la página.
    .replace(/ · \*\*Estado:\*\* borrador para revisión jurídica/, '');

  for (const [de, a] of SUSTITUCIONES[documento] ?? []) s = s.replace(de, a);

  // Red de seguridad: si el borrador gana un marcador nuevo, se quita la oración entera
  // en lugar de publicar un hueco. (Hay que agregarlo a SUSTITUCIONES y a PENDIENTES-JURIDICO.md.)
  s = s.split('\n').map((linea) => {
    if (!MARCADOR.test(linea)) return linea;
    const oraciones = linea.split(/(?<=[.:;])\s+/).filter((o) => !MARCADOR.test(o));
    return oraciones.join(' ');
  }).join('\n');

  // Renumera las secciones "## N." por si se quitó alguna vacía.
  let n = 0;
  s = s.replace(/^## \d+\. /gm, () => `## ${++n}. `);

  // Enlaces cuyo texto es el nombre del archivo: se muestran con el nombre del documento.
  const NOMBRES: Record<string, string> = { 'aviso-privacidad': 'el Aviso de Privacidad Integral', terminos: 'los Términos y Condiciones', 'aviso-simplificado': 'el Aviso de Privacidad Simplificado' };
  s = s.replace(/\[([\w-]+)\.md\]\(([\w-]+)\.md\)/g, (m, texto: string, destino: string) => (NOMBRES[destino] ? `[${NOMBRES[destino]}](${destino}.md)` : m));

  // Enlaces entre documentos, con el prefijo del sitio (GitHub Pages usa /POL-IAQ).
  return s.replace(/\]\(([\w-]+)\.md\)/g, `](${base}/legal/$1/)`);
}
