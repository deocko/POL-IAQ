/**
 * Consola de operador: solo para municipios cuyo CAD no tenga consola propia.
 * TODO(fase 1): bandeja de reportes en tiempo real, mapa de unidades, chat y
 * reasignación, con SSO + segundo factor y acceso limitado por municipio.
 */
export default function Consola() {
  return (
    <main>
      <h1>Consola de operador</h1>
      <p className="suave">En construcción. Se usará solo donde el CAD municipal no tenga consola propia; los CAD de Querétaro, Corregidora y El Marqués se integran por API.</p>
    </main>
  );
}
