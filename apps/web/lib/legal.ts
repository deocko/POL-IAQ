/**
 * Prepara los borradores de docs/legal para publicarlos en la web sin notas
 * internas ni marcadores sin llenar. No inventa datos: lo que falta se
 * muestra como "(por definir)" y la lista completa está en
 * docs/legal/PENDIENTES-JURIDICO.md.
 */
const INSTRUCCION = /^(COMPLETAR|CONFIRMAR|REVISAR|CITAR)\b/i;
const PLAZO = /^\d+\s+(d[ií]as|meses|años|horas)/i;

export function paraPublicar(md: string, documento: string, base = ''): string {
  let s = md
    // Notas para el equipo (blockquotes "> Nota para el equipo …").
    .replace(/^> Nota para el equipo[^\n]*\n?/gim, '')
    .replace('Este archivo reúne los textos cortos que aparecen en la app. ', 'Textos cortos que aparecen en la app. ')
    .replace('**Estado:** borrador para revisión jurídica', '**Estado:** borrador en revisión jurídica; los datos “por definir” se publicarán cuando el área jurídica los proporcione');

  // Párrafos que solo son una instrucción para jurídico.
  s = s.replace(/^\[((?:COMPLETAR|CONFIRMAR|REVISAR|CITAR)[^\]]*)\]\s*$/gim, '*Pendiente de revisión jurídica.*');

  // Marcadores en línea (no los enlaces [texto](url)).
  s = s.replace(/\[([^\]\n]+)\](?!\()/g, (_m, dentro: string) => {
    const t = dentro.trim();
    if (t === 'URL') return documento === 'aviso-privacidad' ? 'esta página' : '[el Aviso de Privacidad Integral](aviso-privacidad.md)';
    if (INSTRUCCION.test(t)) return '(pendiente de revisión jurídica)';
    if (PLAZO.test(t)) return '(plazo por definir)';
    return '(por definir)';
  });

  // Enlaces entre documentos, con el prefijo del sitio (GitHub Pages usa /POL-IAQ).
  return s.replace(/\]\(([\w-]+)\.md\)/g, `](${base}/legal/$1/)`);
}
