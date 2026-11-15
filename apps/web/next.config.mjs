/**
 * NEXT_PUBLIC_DEMO=1 genera la demo pública: export estático para GitHub Pages
 * (https://deocko.github.io/POL-IAQ/), con el API y el CAD simulados en el navegador.
 *
 * Cada build de la demo lleva una versión (commit + hora del build) que se ve en la app y en la consola,
 * y se publica en /version.json. Si el navegador o la CDN sirven una página de un build anterior, la página
 * lo detecta al cargar y se recarga una vez con la versión nueva (lib/version-script.ts).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const demo = process.env.NEXT_PUBLIC_DEMO === '1';
const basePath = process.env.DEMO_BASE_PATH ?? '/POL-IAQ';

function versionDelBuild() {
  let commit = process.env.GITHUB_SHA?.slice(0, 7);
  if (!commit) try { commit = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { commit = 'local'; }
  const fecha = new Date().toISOString();
  return { id: `${commit}-${Date.parse(fecha).toString(36)}`, commit, fecha };
}

// next build carga este archivo en varios procesos: la versión se calcula una vez y pasa a los demás por el entorno.
if (demo && !process.env.POLIAQ_VERSION) process.env.POLIAQ_VERSION = JSON.stringify(versionDelBuild());
const version = demo ? JSON.parse(process.env.POLIAQ_VERSION) : { id: 'dev', commit: 'dev', fecha: '' };
// public/version.json se copia al export; no se versiona en git.
if (demo) { mkdirSync('public', { recursive: true }); writeFileSync('public/version.json', `${JSON.stringify(version)}\n`); }

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: demo ? basePath : '',
    NEXT_PUBLIC_VERSION: version.id,
    NEXT_PUBLIC_VERSION_COMMIT: version.commit,
    NEXT_PUBLIC_VERSION_FECHA: version.fecha,
  },
  ...(demo && { output: 'export', basePath, trailingSlash: true, images: { unoptimized: true } }),
};
export default nextConfig;
