import Link from 'next/link';

const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export default function Inicio() {
  return (
    <main>
      <h1>Pol-IAQ</h1>
      {DEMO && (
        <section className="demo-portada">
          <strong>Demo en vivo con datos de prueba</strong>
          <p>Nada de lo que hagas aquí llega a la policía. El API y el CAD están simulados en tu navegador.</p>
          <ol>
            <li><Link href="/demo/">Abre la app ciudadana</Link>, regístrate con el código <code>000000</code> y envía un reporte.</li>
            <li>Recibe tu folio unificado (QRO-municipio-año-consecutivo).</li>
            <li>En otra pestaña abre la <Link href="/consola/">consola del operador</Link> (usuario <code>operador</code>, clave <code>operador</code>) y síguelo hasta cerrarlo.</li>
          </ol>
        </section>
      )}
      <p>Reporta emergencias a la policía de tu municipio y sigue la atención en tiempo real con un folio único.</p>
      <p>Municipios participantes en el piloto: Querétaro, Corregidora y El Marqués.</p>
      <blockquote>Pol-IAQ no sustituye al 911. Si no puedes usar la app, llama al 911.</blockquote>
      <ul>
        <li><Link href="/legal/aviso-privacidad">Aviso de Privacidad Integral</Link></li>
        <li><Link href="/legal/aviso-simplificado">Aviso de Privacidad Simplificado</Link></li>
        <li><Link href="/legal/terminos">Términos y Condiciones</Link></li>
        <li><Link href="/consola/">Consola de operador</Link></li>
      </ul>
    </main>
  );
}
