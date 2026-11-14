/**
 * Genera el hash de una clave de operador para OPERADORES_JSON.
 * Uso: pnpm --filter @pol-iaq/api hash-clave '<clave>'
 */
import { hashClave } from '../config';

const clave = process.argv[2];
if (!clave || clave.length < 12) {
  console.error('Uso: hash-clave <clave de al menos 12 caracteres>');
  process.exit(1);
}
console.log(hashClave(clave));
