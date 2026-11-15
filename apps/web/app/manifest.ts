import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Manifiesto PWA: se puede "instalar" la app ciudadana web desde el navegador. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'POL-IAQ · Asistencia directa',
    short_name: 'POL-IAQ',
    description: 'Reporta emergencias a la policía de tu municipio en Querétaro y sigue la atención en tiempo real.',
    lang: 'es-MX',
    start_url: `${base}/demo/`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#000D37',
    theme_color: '#000D37',
    icons: [
      { src: `${base}/marca/icono-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/marca/icono-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/marca/icono-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
