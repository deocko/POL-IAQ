import { defineConfig } from 'vitest/config';
// Los dos archivos de pruebas borran y recrean el esquema de la misma base de PostgreSQL de pruebas:
// corren uno tras otro para no pisarse.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 15000, fileParallelism: false } });
