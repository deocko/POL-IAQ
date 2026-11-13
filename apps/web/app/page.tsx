import Link from 'next/link';

export default function Inicio() {
  return (
    <main>
      <h1>Pol-IAQ</h1>
      <p>Reporta emergencias a la policía de tu municipio y sigue la atención en tiempo real con un folio único.</p>
      <p>Municipios participantes en el piloto: Querétaro, Corregidora y El Marqués.</p>
      <blockquote>Pol-IAQ no sustituye al 911. Si no puedes usar la app, llama al 911.</blockquote>
      <ul>
        <li><Link href="/legal/aviso-privacidad">Aviso de Privacidad Integral</Link></li>
        <li><Link href="/legal/aviso-simplificado">Aviso de Privacidad Simplificado</Link></li>
        <li><Link href="/legal/terminos">Términos y Condiciones</Link></li>
        <li><Link href="/consola">Consola de operador</Link></li>
      </ul>
    </main>
  );
}
