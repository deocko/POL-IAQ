import Link from 'next/link';
import { Logo } from '../lib/marca';

const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export default function Inicio() {
  return (
    <main className="portada">
      <header className="portada-cabeza">
        <Logo tam={176} />
        <h1>Pide ayuda en segundos</h1>
        <p>Reporta emergencias a la policía de tu municipio y sigue la atención en tiempo real con un folio único.</p>
      </header>
      <div className="portada-acciones">
        <Link className="c-boton c-grande" href="/demo/">Abrir la app ciudadana</Link>
        <Link className="c-boton-sec c-grande" href="/consola/">Consola del operador</Link>
      </div>
      {DEMO && (
        <section className="demo-portada" aria-label="Cómo probar la demo">
          <strong>Demo con datos de prueba</strong>
          <p>Nada de lo que hagas aquí llega a la policía. El API y el CAD se simulan en tu navegador.</p>
          <ol>
            <li>En la app, regístrate con cualquier teléfono de 10 dígitos y el código <code>000000</code>.</li>
            <li>Toca lo que pasa y luego <strong>Enviar reporte</strong>: recibes tu folio y ves llegar la unidad en el mapa.</li>
            <li>Para despachar tú, elige en <strong>Perfil</strong> “Un operador en la consola” y entra a la consola con <code>operador</code> / <code>operador</code>.</li>
          </ol>
        </section>
      )}
      <p className="suave">Municipios del piloto: Querétaro, Corregidora y El Marqués. Los demás municipios se conectan con su CAD o con la consola; mientras tanto, los reportes de municipios sin CAD los atiende el CQ CIAS (Centro de Información y Análisis para la Seguridad de Querétaro), que opera el 911 y el 089.</p>
      <p><Link href="/tiempos/">Tiempos de respuesta públicos</Link></p>
      <blockquote>POL-IAQ no sustituye al 911. Si no puedes usar la app, llama al <a href="tel:911">911</a>.</blockquote>
      <ul className="enlaces-legales">
        <li><Link href="/legal/aviso-privacidad/">Aviso de privacidad integral</Link></li>
        <li><Link href="/legal/aviso-simplificado/">Aviso de privacidad simplificado</Link></li>
        <li><Link href="/legal/terminos/">Términos y condiciones</Link></li>
      </ul>
    </main>
  );
}
