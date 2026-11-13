import { Inject, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Almacen } from '../almacen/almacen';
import type { Reporte } from '../almacen/modelos';
import { DespachadorCadService } from '../cad/despachador.service';
import { BusService } from '../comun/bus.service';
import { CONFIG, type Config } from '../config';
import { ProtocolosService } from '../protocolos/protocolos.service';
import { sesionOperador } from './operador.guard';
import { vistaOperador } from './vista';

/**
 * Bandeja de la consola en tiempo real (namespace /operacion).
 * Cada operador entra a la sala de sus CAD (`cad:<id>`, o `cad:*` en supervisión)
 * y recibe `reporte.actualizado` con la vista de operador. Tras una
 * transferencia, el CAD de origen también la recibe para sacarla de su bandeja.
 * TODO(fase 2): adaptador de Redis para escalar a varias instancias.
 */
@WebSocketGateway({ namespace: '/operacion', cors: { origin: true } })
export class OperacionGateway implements OnModuleInit {
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(BusService) private readonly bus: BusService,
    @Inject(ProtocolosService) private readonly protocolos: ProtocolosService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
  ) {}

  onModuleInit() {
    this.bus.on('reporte.cambio', (r: Reporte, cadAnterior?: string) => void this.emitir(r, cadAnterior));
  }

  private async emitir(r: Reporte, cadAnterior?: string) {
    if (!this.server) return;
    const salas = ['cad:*', `cad:${r.cadId}`, ...(cadAnterior ? [`cad:${cadAnterior}`] : [])];
    const vista = vistaOperador(r, await this.almacen.ciudadano(r.ciudadanoId), this.protocolos.vigente(), this.config, this.despachador);
    this.server.to(salas).emit('reporte.actualizado', vista);
  }

  @SubscribeMessage('suscribir')
  suscribir(@ConnectedSocket() socket: Socket, @MessageBody() body: { token?: string }) {
    const op = sesionOperador(this.config, body?.token);
    if (!op) return { ok: false, codigo: 'no_autorizado' };
    void socket.join(op.cads.includes('*') ? ['cad:*'] : op.cads.map((c) => `cad:${c}`));
    return { ok: true };
  }
}
