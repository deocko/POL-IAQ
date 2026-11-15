/**
 * Logo oficial de POL-IAQ (archivo original en public/logo-pol-iaq.jpg).
 * - Logo: el cuadro azul marino con el texto, tal cual. Para pantallas de inicio y pie.
 * - Marca: escudo + burbuja sobre su cuadro azul marino, sin texto. Para espacios pequeños
 *   y fondos claros (el cuadro conserva el contraste del logo).
 */
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function Logo({ tam = 200, className = '' }: { tam?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`logo ${className}`} src={`${base}/marca/logo-640.png`} width={tam} height={tam} alt="POL-IAQ · Asistencia directa" decoding="async" />;
}

export function Marca({ tam = 32, conTexto = true, className = '' }: { tam?: number; conTexto?: boolean; className?: string }) {
  return (
    <span className={`marca ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${base}/marca/marca-256.png`} width={tam} height={tam} alt={conTexto ? '' : 'POL-IAQ'} decoding="async" />
      {conTexto && <span className="marca-texto">POL-IAQ</span>}
    </span>
  );
}
