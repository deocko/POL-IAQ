import { randomUUID } from 'node:crypto';
import { Almacen } from './almacen';
import type { Auditoria, Ciudadano, Envio, Otp, Reporte } from './modelos';

const copia = <T>(x: T): T => structuredClone(x);

/** Almacén en memoria: pruebas y demos sin base de datos. Se pierde al reiniciar. */
export class AlmacenMemoria extends Almacen {
  private readonly ciudadanos = new Map<string, Ciudadano>();
  private readonly reportes = new Map<string, Reporte>();
  private readonly consecutivos = new Map<string, number>();
  private readonly eventosProcesados = new Set<string>();
  private readonly contenidos = new Map<string, Buffer>();
  private readonly bitacora: Auditoria[] = [];
  private readonly otps: Otp[] = [];
  private readonly envios = new Map<string, Envio>();
  private readonly colas = new Map<string, Promise<unknown>>();

  async ciudadanoPorTelefono(telefono: string) {
    const c = [...this.ciudadanos.values()].find((x) => x.telefono === telefono);
    return c && copia(c);
  }
  async ciudadano(id: string) {
    const c = this.ciudadanos.get(id);
    return c && copia(c);
  }
  async guardarCiudadano(c: Ciudadano) {
    this.ciudadanos.set(c.id, copia(c));
  }

  async siguienteConsecutivo(claveMunicipio: string, anio: number) {
    const k = `${claveMunicipio}-${anio}`;
    const n = (this.consecutivos.get(k) ?? 0) + 1;
    this.consecutivos.set(k, n);
    return n;
  }

  async reporte(folio: string) {
    const r = this.reportes.get(folio);
    return r && copia(r);
  }
  async guardarReporte(r: Reporte) {
    this.reportes.set(r.folio, copia(r));
  }
  async reportesDe(ciudadanoId: string) {
    return [...this.reportes.values()].filter((r) => r.ciudadanoId === ciudadanoId).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)).map(copia);
  }
  async contarReportesDesde(ciudadanoId: string, desdeIso: string) {
    return [...this.reportes.values()].filter((r) => r.ciudadanoId === ciudadanoId && r.creadoEn >= desdeIso).length;
  }
  async evidencia(evidenciaId: string) {
    for (const r of this.reportes.values()) {
      const e = r.evidencias.find((x) => x.id === evidenciaId);
      if (e) return { folio: r.folio, evidencia: copia(e) };
    }
    return undefined;
  }

  /** Serializa los cambios por folio. A diferencia de PostgreSQL, no deshace lo guardado si `fn` falla. */
  async conReporte<T>(folio: string, fn: () => Promise<T>): Promise<T> {
    const previa = this.colas.get(folio) ?? Promise.resolve();
    const actual = previa.catch(() => undefined).then(fn);
    this.colas.set(folio, actual);
    try {
      return await actual;
    } finally {
      if (this.colas.get(folio) === actual) this.colas.delete(folio);
    }
  }

  async marcarEventoProcesado(eventoId: string) {
    if (this.eventosProcesados.has(eventoId)) return false;
    this.eventosProcesados.add(eventoId);
    return true;
  }

  async guardarContenido(evidenciaId: string, datos: Buffer) {
    this.contenidos.set(evidenciaId, datos);
  }
  async contenido(evidenciaId: string) {
    return this.contenidos.get(evidenciaId);
  }

  async auditar(entrada: Omit<Auditoria, 'en'>) {
    this.bitacora.push({ en: new Date().toISOString(), ...entrada });
  }
  async auditoria(folio?: string) {
    return this.bitacora.filter((a) => !folio || a.folio === folio).map(copia);
  }

  async registrarOtp(otp: Omit<Otp, 'id' | 'intentos' | 'usado' | 'creadoEn'>) {
    this.otps.push({ ...otp, id: randomUUID(), intentos: 0, usado: false, creadoEn: new Date().toISOString() });
  }
  async ultimoOtp(telefono: string) {
    const o = this.otps.filter((x) => x.telefono === telefono).at(-1);
    return o && copia(o);
  }
  async contarOtpsDesde(telefono: string, desdeIso: string) {
    return this.otps.filter((x) => x.telefono === telefono && x.creadoEn >= desdeIso).length;
  }
  async actualizarOtp(id: string, cambios: Pick<Otp, 'intentos' | 'usado'>) {
    const o = this.otps.find((x) => x.id === id);
    if (o) Object.assign(o, cambios);
  }

  async guardarEnvio(e: Envio) {
    this.envios.set(e.evento.eventoId, copia(e));
  }
  async enviosPendientes() {
    return [...this.envios.values()].filter((e) => e.estado === 'pendiente').map(copia);
  }
}
