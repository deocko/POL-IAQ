import type { Metadata, Viewport } from 'next';
import { SCRIPT_TEMA } from '../lib/tema-script';
import './globals.css';

export const metadata: Metadata = {
  title: 'POL-IAQ · Asistencia directa',
  applicationName: 'POL-IAQ',
  appleWebApp: { capable: true, title: 'POL-IAQ', statusBarStyle: 'black-translucent' },
  description: 'Reporta emergencias a la policía de tu municipio en Querétaro y sigue la atención en tiempo real.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#000d37' },
    { media: '(prefers-color-scheme: dark)', color: '#000d37' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" data-tema="claro" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
