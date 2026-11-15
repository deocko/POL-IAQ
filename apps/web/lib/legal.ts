/**
 * Prepara los borradores de docs/legal para publicarlos en la web: sin notas
 * internas, sin marcadores ni huecos "por definir". No inventa ningún dato:
 * cada dato que falta se omite o se sustituye por una frase general que remite
 * a la versión definitiva. La lista exacta de lo que debe entregar el área
 * jurídica está en docs/legal/PENDIENTES-JURIDICO.md.
 */

/** Sustituciones exactas por documento: [texto del borrador, texto publicado]. */
const SUSTITUCIONES: Record<string, [string | RegExp, string][]> = {
  'aviso-privacidad': [
    [/^\[NOMBRE DEL RESPONSABLE[^\n]*$/m,
      'Este aviso explica cómo se tratan los datos personales que proporcionas al usar la aplicación y el sitio web Pol-IAQ (en adelante, "Pol-IAQ"). La identidad y el domicilio del responsable se incluirán en la versión definitiva de este aviso.'],
    [', [CURP, si se solicita]', ''],
    [' o escribe a [CORREO DE LA UNIDAD DE TRANSPARENCIA]', ''],
    [/^\[COMPLETAR por el área jurídica: artículos aplicables[^\n]*$/m, 'El fundamento legal del tratamiento se incluirá en la versión definitiva de este aviso.'],
    [' y [CONFIRMAR: no requieren tu consentimiento conforme a la ley aplicable]', ''],
    [' Los datos se alojan en [PAÍS/REGIÓN, de preferencia México].', ''],
    ['| [12 meses] después del cierre; luego se eliminan o anonimizan |', '| Al terminar su plazo de conservación se eliminan o anonimizan |'],
    ['| [5 años] |', '| Durante su plazo de conservación |'],
    [' al cancelarla se elimina en [30 días], salvo', ' al cancelarla se elimina, salvo'],
    [/^- \*\*Por escrito o en persona:\*\* Unidad de Transparencia de \[RESPONSABLE\][^\n]*$/m,
      '- **Por escrito o en persona:** ante la Unidad de Transparencia del responsable, cuyos datos de contacto se incluirán en la versión definitiva de este aviso.'],
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
    ['ante [AUTORIDADES O TRIBUNALES COMPETENTES EN SANTIAGO DE QUERÉTARO].', 'ante las autoridades competentes.'],
    [/^\[CORREO\] · \[TELÉFONO\] · \[DOMICILIO\]$/m, 'Los datos de contacto se incluirán en la versión definitiva de estos Términos.'],
  ],
  'aviso-simplificado': [
    ['[RESPONSABLE] trata tu nombre', 'Tratamos tu nombre'],
    ['está en [aviso-privacidad.md](aviso-privacidad.md) y los términos en [terminos.md](terminos.md).', 'está en el [Aviso de Privacidad Integral](aviso-privacidad.md) y los términos, en [Términos y Condiciones](terminos.md).'],
    ['Consulta el aviso integral en [URL].', 'Consulta el [Aviso de Privacidad Integral](aviso-privacidad.md).'],
  ],
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

  // Enlaces cuyo texto es el nombre del archivo: se muestran con el nombre del documento.
  const NOMBRES: Record<string, string> = { 'aviso-privacidad': 'el Aviso de Privacidad Integral', terminos: 'los Términos y Condiciones', 'aviso-simplificado': 'el Aviso de Privacidad Simplificado' };
  s = s.replace(/\[([\w-]+)\.md\]\(([\w-]+)\.md\)/g, (m, texto: string, destino: string) => (NOMBRES[destino] ? `[${NOMBRES[destino]}](${destino}.md)` : m));

  // Enlaces entre documentos, con el prefijo del sitio (GitHub Pages usa /POL-IAQ).
  return s.replace(/\]\(([\w-]+)\.md\)/g, `](${base}/legal/$1/)`);
}
