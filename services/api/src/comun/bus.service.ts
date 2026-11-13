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
  /** Un reporte cambió y hay que avisar al ciudadano en tiempo real. */
  reporteCambio(r: Reporte) {
    this.emit('reporte.cambio', r);
  }
}
