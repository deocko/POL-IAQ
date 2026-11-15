/** Busca texto JSX pegado a una {expresión} en el mismo elemento (ver espacios.test.ts). */
const LETRA = /[\p{L}\p{N}]/u;
const PALABRA_CLAVE = /^\s*(catch|else|finally|from|as|return|of|in)\s*$/;

/** Texto JSX pegado a una {expresión} dentro del mismo elemento. */
export function textosPartidos(fuente: string): string[] {
  const malos: string[] = [];
  fuente.split('\n').forEach((linea, i) => {
    // Lo que va dentro de `…${}…` ya es un solo texto.
    const l = linea.trim().replace(/`(?:[^`\\]|\\.)*`/g, '``');
    if (!l.includes('<') || l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) return;
    const patrones = [
      /(?<!=)>([^<>{}]+)\{(?!\/\*)/g, // >Texto {expr}
      /\}([^<>{}]+)</g, // {expr} texto<
      /\}([^<>{}]+)\{(?!\/\*)/g, // {expr} texto {expr}
    ];
    for (const re of patrones) {
      for (const m of l.matchAll(re)) {
        const t = m[1];
        // Código TypeScript (no texto JSX): flechas, llamadas, asignaciones, tipos.
        if (/[=;()`'"|&]|=>|\?\?/.test(t) || !LETRA.test(t) || PALABRA_CLAVE.test(t)) continue;
        malos.push(`${i + 1}: …${l.slice(Math.max(0, m.index! - 20), m.index! + m[0].length + 20)}…`);
      }
    }
  });
  return malos;
}

