/**
 * Reglas de búsqueda de texto que comparten la bandeja del operador y la tabla de folios: sin acentos ni
 * mayúsculas, y un número también se busca solo en sus dígitos (teléfonos con espacios, guiones o +52).
 */
import { normalizar } from './protocolos';

export const soloDigitos = (s: string) => s.replace(/\D/g, '');

/** ¿El texto parece un número (teléfono, CP, folio numérico)? Solo dígitos y separadores comunes. */
export const esNumero = (s: string) => soloDigitos(s).length > 0 && soloDigitos(s).length === s.replace(/[\s()+.-]/g, '').length;

/** ¿La celda contiene el texto? Sin acentos ni mayúsculas; un número de 3 dígitos o más también se busca solo en los dígitos. */
export function contiene(celda: string, buscado: string): boolean {
  const q = normalizar(buscado);
  if (!q) return true;
  if (normalizar(celda).includes(q)) return true;
  const d = soloDigitos(buscado);
  return d.length >= 3 && esNumero(buscado) && soloDigitos(celda).includes(d);
}

/** Palabras de una búsqueda general: cada una debe aparecer en algún campo. */
export const palabrasDe = (texto: string | null | undefined) => (texto ?? '').trim().split(/\s+/).filter(Boolean);

/** ¿Cada palabra aparece en alguno de los campos? Sin palabras, sí. */
export function coincideTodo(campos: readonly string[], texto: string | null | undefined): boolean {
  const palabras = palabrasDe(texto);
  return !palabras.length || palabras.every((p) => campos.some((c) => contiene(c, p)));
}
