/** Aplica las migraciones pendientes: `pnpm --filter @pol-iaq/api db:migrar`. */
import { Pool } from 'pg';
import { migrar } from './almacen/migraciones';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Define DATABASE_URL');
  const pool = new Pool({ connectionString: url });
  try {
    const aplicadas = await migrar(pool);
    console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'La base ya estaba al día.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
