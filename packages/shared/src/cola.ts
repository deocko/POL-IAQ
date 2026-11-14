/**
 * Cola de envío sin conexión: el reporte se guarda en el teléfono y se envía
 * solo cuando vuelve la conexión. Lógica pura; cada app pone el almacenamiento.
 */
export interface PendienteEnvio<T> {
  id: string;
  datos: T;
  creadoEn: string;
  intentos: number;
  ultimoError?: string;
}

/** Si en este tiempo no se pudo enviar, la app ofrece llamar al 911 de forma destacada. */
export const ESPERA_ANTES_DE_911_SEG = 60;

export const debeOfrecer911 = (p: Pick<PendienteEnvio<unknown>, 'creadoEn'>, ahora = Date.now()) =>
  ahora - new Date(p.creadoEn).getTime() >= ESPERA_ANTES_DE_911_SEG * 1000;

export function encolar<T>(cola: PendienteEnvio<T>[], id: string, datos: T, ahora = new Date()): PendienteEnvio<T>[] {
  return [...cola, { id, datos, creadoEn: ahora.toISOString(), intentos: 0 }];
}

/**
 * Intenta enviar en orden de llegada. Se detiene en el primer fallo (sigue sin
 * conexión) y deja ese y los siguientes en la cola.
 */
export async function vaciarCola<T, R>(
  cola: PendienteEnvio<T>[],
  enviar: (p: PendienteEnvio<T>) => Promise<R>,
): Promise<{ enviados: { pendiente: PendienteEnvio<T>; resultado: R }[]; restantes: PendienteEnvio<T>[] }> {
  const enviados: { pendiente: PendienteEnvio<T>; resultado: R }[] = [];
  for (let i = 0; i < cola.length; i++) {
    try {
      enviados.push({ pendiente: cola[i], resultado: await enviar(cola[i]) });
    } catch (err) {
      const fallido = { ...cola[i], intentos: cola[i].intentos + 1, ultimoError: (err as Error)?.message ?? String(err) };
      return { enviados, restantes: [fallido, ...cola.slice(i + 1)] };
    }
  }
  return { enviados, restantes: [] };
}
