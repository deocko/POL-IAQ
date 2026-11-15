/**
 * Horas en la zona de los municipios piloto (Querétaro: America/Mexico_City),
 * sin importar la zona del navegador o del servidor que genera la página.
 */
export const ZONA_HORARIA = 'America/Mexico_City';

const SIN_SEGUNDOS = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit' });
const CON_SEGUNDOS = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "05:33 a.m." (con espacios normales: algunos lectores pierden el espacio angosto de Intl). */
export function horaLocal(iso: string | number | Date, segundos = false): string {
  return (segundos ? CON_SEGUNDOS : SIN_SEGUNDOS).format(new Date(iso)).replace(/[  ]/g, ' ');
}
