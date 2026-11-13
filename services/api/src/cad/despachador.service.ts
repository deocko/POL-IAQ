import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { CAD_ESTATAL_ID, firmar, type EventoHaciaCad } from '@pol-iaq/shared';
import { AlmacenService } from '../almacen/almacen.service';
import type { Ciudadano, Evidencia, Reporte } from '../almacen/modelos';
import { CONFIG, type Config } from '../config';

const REINTENTOS_MS = [0, 1000, 2000, 4000, 8000, 16000];
const VIGENCIA_ENLACE_SEG = 15 * 60;

export interface Envio {
  cadId: string;
  evento: EventoHaciaCad;
  intentos: number;
  estado: 'pendiente' | 'entregado' | 'fallido' | 'sin_configuracion';
}

/**
 * Envía eventos de Pol-IAQ a los CAD (bandeja de salida con reintentos) y
 * escala al C5 si el CAD municipal no acusa recibo a tiempo.
 */
@Injectable()
export class DespachadorCadService implements OnModuleDestroy {
  private readonly log = new Logger('DespachadorCad');
  private readonly temporizadores = new Set<NodeJS.Timeout>();
  /** Bandeja de salida (en memoria en el scaffold). */
  readonly bandeja: Envio[] = [];

  constructor(@Inject(CONFIG) private readonly config: Config, @Inject(AlmacenService) private readonly almacen: AlmacenService) {}

  onModuleDestroy() {
    this.temporizadores.forEach(clearTimeout);
  }

  enviarCreado(r: Reporte, ciudadano: Ciudadano) {
    const evento: EventoHaciaCad = {
      tipo: 'incidente.creado',
      eventoId: randomUUID(),
      folio: r.folio,
      secuencia: ++r.secuenciaSalida,
      ocurridoEn: new Date().toISOString(),
      datos: {
        incidenteId: r.incidenteId,
        codigoCnie: r.codigoCnie,
        prioridad: r.prioridad,
        corporacionSugerida: r.corporacionSugerida,
        ubicacion: r.ubicacion,
        municipioClave: r.municipioClave,
        descripcion: r.descripcion,
        respuestas: r.respuestas,
        esPanico: r.esPanico,
        reportante: { nombre: ciudadano.nombre, telefono: ciudadano.telefono, confiabilidad: ciudadano.confiabilidad },
        evidencias: r.evidencias.filter((e) => e.estado === 'verificada').map((e) => this.enlaceEvidencia(r, e)),
      },
    };
    this.encolar(r.cadId, evento);
    if (r.cadId !== CAD_ESTATAL_ID) this.vigilarAcuse(r.folio, r.cadId, ciudadano);
  }

  enviarActualizado(r: Reporte, datos: Extract<EventoHaciaCad, { tipo: 'incidente.actualizado' }>['datos']) {
    this.encolar(r.cadId, { tipo: 'incidente.actualizado', eventoId: randomUUID(), folio: r.folio, secuencia: ++r.secuenciaSalida, ocurridoEn: new Date().toISOString(), datos });
  }

  /** Enlace firmado y con caducidad para que el CAD descargue la evidencia. */
  enlaceEvidencia(r: Reporte, e: Evidencia) {
    const exp = Math.floor(Date.now() / 1000) + VIGENCIA_ENLACE_SEG;
    const firma = createHmac('sha256', this.config.secretoTokens).update(`${e.id}.${r.cadId}.${exp}`).digest('hex');
    return {
      id: e.id,
      tipo: e.tipo,
      url: `${this.config.urlPublica}/v1/cad/${r.cadId}/evidencias/${e.id}?exp=${exp}&firma=${firma}`,
      sha256: e.sha256Servidor ?? e.sha256Declarado,
      expiraEn: new Date(exp * 1000).toISOString(),
    };
  }

  firmaEnlaceValida(evidenciaId: string, cadId: string, exp: number, firma: string) {
    if (!(exp > Date.now() / 1000)) return false;
    return createHmac('sha256', this.config.secretoTokens).update(`${evidenciaId}.${cadId}.${exp}`).digest('hex') === firma;
  }

  private vigilarAcuse(folio: string, cadId: string, ciudadano: Ciudadano) {
    const t = setTimeout(() => {
      this.temporizadores.delete(t);
      const r = this.almacen.reporte(folio);
      if (!r || r.folioCad || r.cadId !== cadId || r.estado !== 'recibido') return;
      this.log.warn(`${folio}: ${cadId} no acusó en ${this.config.esperaAcuseSeg}s, se escala al C5`);
      this.almacen.auditar({ actor: 'sistema', accion: 'escalado_c5_sin_acuse', folio, detalle: { cadId } });
      r.cadId = CAD_ESTATAL_ID;
      this.almacen.guardarReporte(r);
      this.enviarCreado(r, ciudadano);
    }, this.config.esperaAcuseSeg * 1000);
    t.unref();
    this.temporizadores.add(t);
  }

  private encolar(cadId: string, evento: EventoHaciaCad) {
    const envio: Envio = { cadId, evento, intentos: 0, estado: 'pendiente' };
    this.bandeja.push(envio);
    if (!this.config.despachoActivo) return;
    const destino = this.config.cads[cadId];
    if (!destino) {
      envio.estado = 'sin_configuracion';
      this.log.warn(`Sin configuración para ${cadId}; ${evento.tipo} de ${evento.folio} queda en bandeja`);
      return;
    }
    void this.intentar(envio, destino.webhookUrl, destino.secreto);
  }

  private async intentar(envio: Envio, url: string, secreto: string): Promise<void> {
    const cuerpo = JSON.stringify(envio.evento);
    while (envio.intentos < REINTENTOS_MS.length) {
      const espera = REINTENTOS_MS[envio.intentos++];
      if (espera) await new Promise((res) => { const t = setTimeout(res, espera); t.unref(); });
      try {
        const ts = Math.floor(Date.now() / 1000);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-poliaq-timestamp': String(ts), 'x-poliaq-firma': firmar(secreto, ts, cuerpo), 'idempotency-key': envio.evento.eventoId },
          body: cuerpo,
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          envio.estado = 'entregado';
          return;
        }
        this.log.warn(`${envio.cadId} respondió ${resp.status} a ${envio.evento.tipo} (${envio.evento.folio})`);
      } catch (err) {
        this.log.warn(`Error enviando a ${envio.cadId}: ${(err as Error).message}`);
      }
    }
    envio.estado = 'fallido';
    this.almacen.auditar({ actor: 'sistema', accion: 'envio_cad_fallido', folio: envio.evento.folio, detalle: { cadId: envio.cadId, tipo: envio.evento.tipo } });
  }
}
