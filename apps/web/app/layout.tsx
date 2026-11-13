import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pol-IAQ',
  description: 'Reporta emergencias a la policía de tu municipio en Querétaro y sigue la atención en tiempo real.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
