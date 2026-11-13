import type { Auditoria, Ciudadano, Envio, Evidencia, Otp, Reporte } from './modelos';

/**
 * Persistencia del API. Hay dos implementaciones:
 * - `AlmacenPostgres` (PostgreSQL + PostGIS), la de producción; se usa cuando
 *   existe `DATABASE_URL`.
 * - `AlmacenMemoria`, para pruebas rápidas y demos sin base de datos.
 *
 * Los objetos que devuelve son copias: para cambiar algo hay que guardarlo.
 */
export abstract class Almacen {
  abstract ciudadanoPorTelefono(telefono: string): Promise<Ciudadano | undefined>;
  abstract ciudadano(id: string): Promise<Ciudadano | undefined>;
  /** Guarda al ciudadano y, si cambió `aceptadoEn`, deja constancia de la aceptación legal. */
  abstract guardarCiudadano(c: Ciudadano): Promise<void>;

  /** Consecutivo atómico por municipio y año para el folio unificado. */
  abstract siguienteConsecutivo(claveMunicipio: string, anio: number): Promise<number>;

  abstract reporte(folio: string): Promise<Reporte | undefined>;
  abstract guardarReporte(r: Reporte): Promise<void>;
  abstract reportesDe(ciudadanoId: string): Promise<Reporte[]>;
  abstract contarReportesDesde(ciudadanoId: string, desdeIso: string): Promise<number>;
  abstract evidencia(evidenciaId: string): Promise<{ folio: string; evidencia: Evidencia } | undefined>;

  /**
   * Ejecuta `fn` con el reporte bloqueado: ningún otro cambio al mismo folio
   * corre a la vez. En PostgreSQL es una transacción con `SELECT … FOR UPDATE`;
   * si `fn` lanza un error, nada de lo que guardó queda escrito.
   */
  abstract conReporte<T>(folio: string, fn: () => Promise<T>): Promise<T>;

  /** Devuelve false si el evento ya se había procesado (idempotencia). */
  abstract marcarEventoProcesado(eventoId: string, cadId: string, folio: string): Promise<boolean>;

  abstract guardarContenido(evidenciaId: string, datos: Buffer): Promise<void>;
  abstract contenido(evidenciaId: string): Promise<Buffer | undefined>;

  abstract auditar(entrada: Omit<Auditoria, 'en'>): Promise<void>;
  abstract auditoria(folio?: string): Promise<Auditoria[]>;

  abstract registrarOtp(otp: Omit<Otp, 'id' | 'intentos' | 'usado' | 'creadoEn'>): Promise<void>;
  abstract ultimoOtp(telefono: string): Promise<Otp | undefined>;
  abstract contarOtpsDesde(telefono: string, desdeIso: string): Promise<number>;
  abstract actualizarOtp(id: string, cambios: Pick<Otp, 'intentos' | 'usado'>): Promise<void>;

  abstract guardarEnvio(e: Envio): Promise<void>;
  abstract enviosPendientes(): Promise<Envio[]>;

  /**
   * Lanza `fn` fuera de la transacción actual. Úsalo para trabajo en segundo
   * plano (reintentos, temporizadores, SMS) que no debe ir en la transacción.
   */
  aparte<T>(fn: () => T): T {
    return fn();
  }

  async cerrar(): Promise<void> {}
}
