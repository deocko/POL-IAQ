import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { CAD_ESTATAL_ID, firmar, transcripcion, type EventoHaciaCad } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import { BusService } from '../comun/bus.service';
import type { Ciudadano, Envio, Evidencia, Reporte } from '../almacen/modelos';
import { CONFIG, type Config } from '../config';

const REINTENTOS_MS = [0, 1000, 2000, 4000, 8000, 16000];
const VIGENCIA_ENLACE_SEG = 15 * 60;

export type { Envio };

/** Cuestionario con su transcripción en texto, tal como lo recibe el CAD. */
export function cuestionarioParaCad(r: Reporte) {
  return { ...r.cuestionario, transcripcion: transcripcion(r.cuestionario) };
}

/**
 * Envía eventos de Pol-IAQ a los CAD (bandeja de salida persistida, con
 * reintentos) y escala al C5 si el CAD municipal no acusa recibo a tiempo.
 * Al arrancar reintenta lo que quedó pendiente en la bandeja.
 *
 * TODO(fase 2): mover reintentos y temporizadores de acuse a un trabajador
 * con cola; hoy viven en el proceso y un reinicio pierde la espera del acuse.
 */
@Injectable()
export class DespachadorCadService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('DespachadorCad');
  private readonly temporizadores = new Set<NodeJS.Timeout>();
  private cerrando = false;
  /** Envíos de este proceso (para diagnóstico y pruebas; la fuente de verdad es la bandeja en la base). */
  readonly bandeja: Envio[] = [];

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(BusService) private readonly bus: BusService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.despachoActivo) return;
    const pendientes = await this.almacen.enviosPendientes();
    if (pendientes.length) this.log.log(`Reintentando ${pendientes.length} envíos pendientes de la bandeja`);
    for (const envio of pendientes) this.lanzar(envio);
  }

  onModuleDestroy() {
    this.cerrando = true;
    this.temporizadores.forEach(clearTimeout);
  }

  /** Encola `incidente.creado`. Incrementa `r.secuenciaSalida`: quien llama guarda el reporte. */
  async enviarCreado(r: Reporte, ciudadano: Ciudadano, escenario?: { id: string; titulo: string }) {
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
        asistenciaDirecta: r.asistenciaDirecta,
        ...(escenario && { escenario }),
        cuestionario: cuestionarioParaCad(r),
        canalizacion: r.canalizacion,
        reportante: { nombre: ciudadano.nombre, telefono: ciudadano.telefono, confiabilidad: ciudadano.confiabilidad },
        evidencias: r.evidencias.filter((e) => e.estado === 'verificada').map((e) => this.enlaceEvidencia(r, e)),
      },
    };
    await this.encolar(r.cadId, evento);
    if (r.cadId !== CAD_ESTATAL_ID) this.vigilarAcuse(r.folio, r.cadId, ciudadano, escenario);
  }

  /** Envía el cuestionario completo y la canalización recalculada tras nuevas respuestas. */
  enviarCuestionario(r: Reporte) {
    return this.enviarActualizado(r, { cuestionario: cuestionarioParaCad(r), canalizacion: r.canalizacion });
  }

  /** Encola `incidente.actualizado`. Incrementa `r.secuenciaSalida`: quien llama guarda el reporte. */
  async enviarActualizado(r: Reporte, datos: Extract<EventoHaciaCad, { tipo: 'incidente.actualizado' }>['datos']) {
    await this.encolar(r.cadId, { tipo: 'incidente.actualizado', eventoId: randomUUID(), folio: r.folio, secuencia: ++r.secuenciaSalida, ocurridoEn: new Date().toISOString(), datos });
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

  private vigilarAcuse(folio: string, cadId: string, ciudadano: Ciudadano, escenario?: { id: string; titulo: string }) {
    this.almacen.aparte(() => {
      const t = setTimeout(() => {
        this.temporizadores.delete(t);
        void this.escalarSiNoAcuso(folio, cadId, ciudadano, escenario).catch((err) => this.log.error(`${folio}: no se pudo escalar al C5: ${(err as Error).message}`));
      }, this.config.esperaAcuseSeg * 1000);
      t.unref();
      this.temporizadores.add(t);
    });
  }

  private async escalarSiNoAcuso(folio: string, cadId: string, ciudadano: Ciudadano, escenario?: { id: string; titulo: string }) {
    if (this.cerrando) return;
    await this.almacen.conReporte(folio, async () => {
      const r = await this.almacen.reporte(folio);
      if (!r || r.folioCad || r.cadId !== cadId || r.estado !== 'recibido') return;
      this.log.warn(`${folio}: ${cadId} no acusó en ${this.config.esperaAcuseSeg}s, se escala al C5`);
      await this.almacen.auditar({ actor: 'sistema', accion: 'escalado_c5_sin_acuse', folio, detalle: { cadId } });
      r.cadId = CAD_ESTATAL_ID;
      await this.enviarCreado(r, ciudadano, escenario);
      await this.almacen.guardarReporte(r);
      this.bus.reporteCambio(r, cadId);
    });
  }

  private async encolar(cadId: string, evento: EventoHaciaCad) {
    const envio: Envio = { cadId, evento, intentos: 0, estado: 'pendiente' };
    this.bandeja.push(envio);
    const cad = this.config.cads[cadId];
    if (cad?.modo === 'consola') {
      // El operador lo ve en la consola web de Pol-IAQ; no hay webhook que llamar.
      envio.estado = 'consola';
    } else if (this.config.despachoActivo && !cad?.webhookUrl) {
      envio.estado = 'sin_configuracion';
      this.log.warn(`Sin configuración para ${cadId}; ${evento.tipo} de ${evento.folio} queda en bandeja`);
    }
    await this.almacen.guardarEnvio(envio);
    if (this.config.despachoActivo && envio.estado === 'pendiente') this.lanzar(envio);
  }

  /** Arranca los intentos de entrega en segundo plano, fuera de la transacción. */
  private lanzar(envio: Envio) {
    const destino = this.config.cads[envio.cadId];
    const { webhookUrl, secreto } = destino ?? {};
    if (!webhookUrl || !secreto || destino?.modo === 'consola') return;
    this.almacen.aparte(() => {
      void this.intentar(envio, webhookUrl, secreto).catch((err) => this.log.error(`Bandeja: ${(err as Error).message}`));
    });
  }

  private async intentar(envio: Envio, url: string, secreto: string): Promise<void> {
    const cuerpo = JSON.stringify(envio.evento);
    while (envio.intentos < REINTENTOS_MS.length && !this.cerrando) {
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
          await this.almacen.guardarEnvio(envio);
          return;
        }
        this.log.warn(`${envio.cadId} respondió ${resp.status} a ${envio.evento.tipo} (${envio.evento.folio})`);
      } catch (err) {
        this.log.warn(`Error enviando a ${envio.cadId}: ${(err as Error).message}`);
      }
    }
    if (this.cerrando) return;
    envio.estado = 'fallido';
    await this.almacen.guardarEnvio(envio);
    await this.almacen.auditar({ actor: 'sistema', accion: 'envio_cad_fallido', folio: envio.evento.folio, detalle: { cadId: envio.cadId, tipo: envio.evento.tipo } });
  }
}
