import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Reporte } from '../almacen/modelos';

/**
 * Bus interno en proceso.
 * TODO(fase 2): reemplazar por colas gestionadas (SQS/SNS o Pub/Sub) con
 * bandeja de salida (outbox) en la base de datos.
 */
@Injectable()
export class BusService extends EventEmitter {
  /**
   * Un reporte cambió: se avisa en tiempo real al ciudadano y a la consola.
   * `cadAnterior` es el CAD que lo tenía antes de una transferencia.
   */
  reporteCambio(r: Reporte, cadAnterior?: string) {
    this.emit('reporte.cambio', r, cadAnterior);
  }
}
