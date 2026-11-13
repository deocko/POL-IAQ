import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Almacen } from '../almacen/almacen';
import type { Reporte } from '../almacen/modelos';
import { leerToken } from '../auth/tokens';
import { BusService } from '../comun/bus.service';
import { CONFIG, type Config } from '../config';
import { vistaCiudadano } from '../reportes/vista';

/**
 * Seguimiento en tiempo real (namespace /seguimiento).
 * El ciudadano se suscribe solo a sus folios y recibe `reporte.actualizado`
 * en cada cambio: estado, unidad, posición o mensaje.
 * TODO(fase 2): adaptador de Redis para escalar a varias instancias.
 */
@WebSocketGateway({ namespace: '/seguimiento', cors: { origin: true } })
export class SeguimientoGateway implements OnModuleInit {
  private readonly log = new Logger('Seguimiento');
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(BusService) private readonly bus: BusService,
  ) {}

  onModuleInit() {
    this.bus.on('reporte.cambio', (r: Reporte) => this.server?.to(`folio:${r.folio}`).emit('reporte.actualizado', vistaCiudadano(r)));
  }

  @SubscribeMessage('suscribir')
  async suscribir(@ConnectedSocket() socket: Socket, @MessageBody() body: { token?: string; folio?: string }) {
    const sesion = body?.token ? leerToken(this.config.secretoTokens, body.token) : null;
    const r = sesion && body?.folio ? await this.almacen.reporte(body.folio) : undefined;
    if (!sesion || !r || r.ciudadanoId !== sesion.sub) return { ok: false, codigo: 'no_autorizado' };
    void socket.join(`folio:${r.folio}`);
    this.log.debug(`socket ${socket.id} sigue ${r.folio}`);
    return { ok: true, reporte: vistaCiudadano(r) };
  }
}
