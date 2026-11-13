import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Carpeta `db/migraciones` del paquete (funciona desde src/ y desde dist/). */
export const CARPETA_MIGRACIONES = join(__dirname, '..', '..', 'db', 'migraciones');

/**
 * Aplica en orden las migraciones `NNN_nombre.sql` que falten. Cada una corre
 * en su propia transacción y un candado evita que dos instancias migren a la vez.
 * Devuelve los nombres de las migraciones aplicadas en esta llamada.
 */
export async function migrar(pool: Pool, carpeta = CARPETA_MIGRACIONES): Promise<string[]> {
  const archivos = readdirSync(carpeta).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query("SELECT pg_advisory_lock(hashtext('pol-iaq:migraciones'))");
    await cliente.query('CREATE TABLE IF NOT EXISTS migracion (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())');
    const { rows } = await cliente.query<{ nombre: string }>('SELECT nombre FROM migracion');
    const hechas = new Set(rows.map((r) => r.nombre));
    for (const archivo of archivos) {
      if (hechas.has(archivo)) continue;
      await cliente.query('BEGIN');
      try {
        await cliente.query(readFileSync(join(carpeta, archivo), 'utf8'));
        await cliente.query('INSERT INTO migracion (nombre) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        aplicadas.push(archivo);
      } catch (err) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falló la migración ${archivo}: ${(err as Error).message}`);
      }
    }
  } finally {
    await cliente.query("SELECT pg_advisory_unlock(hashtext('pol-iaq:migraciones'))").catch(() => undefined);
    cliente.release();
  }
  return aplicadas;
}
