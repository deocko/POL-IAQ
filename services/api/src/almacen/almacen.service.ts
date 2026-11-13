import { Injectable } from '@nestjs/common';
import type { Auditoria, Ciudadano, Reporte } from './modelos';

/**
 * Almacén en memoria para desarrollo y pruebas.
 *
 * TODO(fase 1): reemplazar por PostgreSQL + PostGIS (ver db/esquema.sql)
 * manteniendo esta misma interfaz pública.
 */
@Injectable()
export class AlmacenService {
  private readonly ciudadanos = new Map<string, Ciudadano>();
  private readonly reportes = new Map<string, Reporte>();
  private readonly consecutivos = new Map<string, number>();
  private readonly eventosProcesados = new Set<string>();
  private readonly contenidos = new Map<string, Buffer>();
  readonly auditoria: Auditoria[] = [];

  ciudadanoPorTelefono(telefono: string) {
    return [...this.ciudadanos.values()].find((c) => c.telefono === telefono);
  }
  ciudadano(id: string) {
    return this.ciudadanos.get(id);
  }
  guardarCiudadano(c: Ciudadano) {
    this.ciudadanos.set(c.id, c);
  }

  siguienteConsecutivo(claveMunicipio: string, anio: number): number {
    const k = `${claveMunicipio}-${anio}`;
    const n = (this.consecutivos.get(k) ?? 0) + 1;
    this.consecutivos.set(k, n);
    return n;
  }

  reporte(folio: string) {
    return this.reportes.get(folio);
  }
  guardarReporte(r: Reporte) {
    this.reportes.set(r.folio, r);
  }
  reportesDe(ciudadanoId: string) {
    return [...this.reportes.values()].filter((r) => r.ciudadanoId === ciudadanoId);
  }
  reportesDesde(ciudadanoId: string, desdeIso: string) {
    return this.reportesDe(ciudadanoId).filter((r) => r.creadoEn >= desdeIso);
  }
  todosLosReportes() {
    return [...this.reportes.values()];
  }

  /** Devuelve false si el evento ya se había procesado (idempotencia). */
  marcarEventoProcesado(eventoId: string): boolean {
    if (this.eventosProcesados.has(eventoId)) return false;
    this.eventosProcesados.add(eventoId);
    return true;
  }

  guardarContenido(evidenciaId: string, datos: Buffer) {
    this.contenidos.set(evidenciaId, datos);
  }

  contenido(evidenciaId: string): Buffer | undefined {
    return this.contenidos.get(evidenciaId);
  }

  auditar(entrada: Omit<Auditoria, 'en'>) {
    this.auditoria.push({ en: new Date().toISOString(), ...entrada });
  }
}
