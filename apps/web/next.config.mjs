/**
 * NEXT_PUBLIC_DEMO=1 genera la demo pública: export estático para GitHub Pages
 * (https://deocko.github.io/POL-IAQ/), con el API y el CAD simulados en el navegador.
 */
const demo = process.env.NEXT_PUBLIC_DEMO === '1';
const basePath = process.env.DEMO_BASE_PATH ?? '/POL-IAQ';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(demo && { output: 'export', basePath, trailingSlash: true, images: { unoptimized: true } }),
};
export default nextConfig;
