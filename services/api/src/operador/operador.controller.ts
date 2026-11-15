import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ESTADOS_FINALES, METAS_PROVISIONALES, agruparPorCnie, candidatasPorCercania, medirTiempos, puedeDespachar, minutosDe, resumirTiempos, subtipoCnie, type EventoDesdeCad, type UnidadAvl,
} from '@pol-iaq/shared';
import { AvlService, RutasService } from '../despacho/avl.service';
import { Almacen } from '../almacen/almacen';
import type { Reporte } from '../almacen/modelos';
import { emitirSesion } from '../auth/tokens';
import { DespachadorCadService } from '../cad/despachador.service';
import { EventosCadService } from '../cad/eventos-cad.service';
import { ZodPipe } from '../comun/zod.pipe';
import { CONFIG, claveValida, type Config } from '../config';
import { ProtocolosService } from '../protocolos/protocolos.service';
import { OperadorGuard, puedeVer, type OperadorSesion } from './operador.guard';
import { CADS_CONOCIDOS, consolaOpera, vistaOperador } from './vista';

const DURACION_SESION_SEG = 12 * 60 * 60;
const MAX_FALLOS = 5;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;

const SesionSchema = z.object({ usuario: z.string().min(1).max(60), clave: z.string().min(1).max(200) });

const AccionSchema = z.discriminatedUnion('accion', [
  /** Acuse: el operador tomó el reporte (detiene el escalamiento al C5). */
  z.object({ accion: z.literal('recibir') }),
  /** Sin `etaMinutos`, el tiempo de llegada se calcula por ruta desde el GPS de la unidad. */
  z.object({ accion: z.literal('asignar'), unidadId: z.string().min(1), etaMinutos: z.number().int().min(0).max(240).optional() }),
  /** Asigna la unidad disponible más cercana de la corporación que pide la canalización. */
  z.object({ accion: z.literal('asignar_cercana') }),
  z.object({ accion: z.literal('estado'), estado: z.enum(['en_camino', 'en_sitio', 'cerrado', 'improcedente']), nota: z.string().max(500).optional() }),
  z.object({ accion: z.literal('mensaje'), texto: z.string().trim().min(1).max(1000) }),
  z.object({ accion: z.literal('transferir'), cadDestinoId: z.string().min(1), motivo: z.string().max(500).optional() }),
  /** Corrige el código CNIE (incidente vigente de 5 dígitos). Queda en la bitácora con el código anterior y el motivo. */
  z.object({
    accion: z.literal('reclasificar'),
    codigoCnie: z.string().trim().min(1).max(10),
    codigoCnieSecundario: z.string().trim().max(10).nullable().optional(),
    motivo: z.string().trim().max(500).optional(),
  }),
]);
type Accion = z.infer<typeof AccionSchema>;

/**
 * Consola web del operador/despachador. Sirve a municipios sin CAD integrado
 * (CAD en modo `consola`) y a supervisión, que ve todo en solo lectura donde
 * el CAD despacha en su propio sistema.
 * TODO(fase 1): SSO (OIDC) con segundo factor en lugar de usuarios en configuración.
 */
@Controller('v1/operador')
export class OperadorController {
  private readonly fallos = new Map<string, number[]>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(EventosCadService) private readonly eventos: EventosCadService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
    @Inject(ProtocolosService) private readonly protocolos: ProtocolosService,
    @Inject(AvlService) private readonly avl: AvlService,
    @Inject(RutasService) private readonly rutas: RutasService,
  ) {}

  @Post('sesion')
  @HttpCode(200)
  async sesion(@Body(new ZodPipe(SesionSchema)) body: z.infer<typeof SesionSchema>) {
    const ahora = Date.now();
    const recientes = (this.fallos.get(body.usuario) ?? []).filter((t) => ahora - t < VENTANA_FALLOS_MS);
    if (recientes.length >= MAX_FALLOS) throw new HttpException({ codigo: 'demasiados_intentos' }, HttpStatus.TOO_MANY_REQUESTS);
    const o = this.config.operadores.find((x) => x.usuario === body.usuario);
    if (!o || !claveValida(body.clave, o.claveHash)) {
      this.fallos.set(body.usuario, [...recientes, ahora]);
      await this.almacen.auditar({ actor: `operador:${body.usuario}`, accion: 'sesion_fallida' });
      throw new UnauthorizedException({ codigo: 'credenciales_invalidas' });
    }
    this.fallos.delete(body.usuario);
    await this.almacen.auditar({ actor: `operador:${o.usuario}`, accion: 'sesion_iniciada' });
    const token = emitirSesion(this.config.secretoTokens, { sub: o.usuario, rol: 'operador', nombre: o.nombre, cads: o.cadIds }, DURACION_SESION_SEG);
    return { token, ...this.yoDe({ usuario: o.usuario, nombre: o.nombre, cads: o.cadIds }) };
  }

  @Get('yo')
  @UseGuards(OperadorGuard)
  yo(@Req() req: { operador: OperadorSesion }) {
    return this.yoDe(req.operador);
  }

  @Get('reportes')
  @UseGuards(OperadorGuard)
  async reportes(@Req() req: { operador: OperadorSesion }, @Query('todos') todos?: string) {
    const lista = await this.almacen.reportesPorCad(req.operador.cads, todos !== '1');
    return { reportes: await Promise.all(lista.map((r) => this.vista(r))) };
  }

  @Get('reportes/:folio')
  @UseGuards(OperadorGuard)
  async reporte(@Req() req: { operador: OperadorSesion }, @Param('folio') folio: string) {
    const r = await this.almacen.reporte(folio);
    if (!r || !puedeVer(req.operador, r.cadId)) throw new NotFoundException({ codigo: 'folio_no_encontrado' });
    await this.almacen.auditar({ actor: `operador:${req.operador.usuario}`, accion: 'reporte_consultado', folio });
    return this.vista(r);
  }

  /** Unidades de los CAD del operador; `ocupada` si atiende un reporte activo. */
  @Get('unidades')
  @UseGuards(OperadorGuard)
  async unidades(@Req() req: { operador: OperadorSesion }) {
    const activos = await this.almacen.reportesPorCad(req.operador.cads, true);
    const ocupadas = new Map(activos.filter((r) => r.unidad).map((r) => [r.unidad!.unidadId, r.folio]));
    return {
      unidades: this.config.unidades
        .filter((u) => puedeVer(req.operador, u.cadId))
        .map((u) => ({ ...u, ocupadaEn: ocupadas.get(u.unidadId) ?? null, posicion: this.avl.posicion(u.unidadId) ?? null })),
    };
  }

  /** Tablero de tiempos de respuesta: cada etapa contra su meta, y quejas. */
  @Get('tiempos')
  @UseGuards(OperadorGuard)
  async tiempos(@Req() req: { operador: OperadorSesion }) {
    const lista = await this.almacen.reportesPorCad(req.operador.cads, false);
    const mediciones = lista.map((r) => ({ r, t: medirTiempos(r.historial, r.prioridad) }));
    return {
      metas: METAS_PROVISIONALES,
      resumen: resumirTiempos(mediciones.map((m) => m.t)),
      reportes: mediciones.map(({ r, t }) => ({ folio: r.folio, cadId: r.cadId, prioridad: r.prioridad, estado: r.estado, creadoEn: r.creadoEn, cnie: r.cnie ?? null, tiempos: t, opinion: r.opinion ?? null })),
      quejas: lista.filter((r) => r.opinion?.queja).length,
      calificacionPromedio: promedio(lista.flatMap((r) => (r.opinion ? [r.opinion.calificacion] : []))),
      porCnie: agruparPorCnie(
        mediciones.map(({ r, t }) => ({ cnie: r.cnie, tiempos: t, queja: !!r.opinion?.queja })),
        (c, n) => subtipoCnie(c)?.nombreCorto ?? n,
      ),
    };
  }

  /** Unidades disponibles con GPS que puede despachar el CAD (el C5, las de todo el estado). */
  private async disponiblesConGps(cadId: string): Promise<UnidadAvl[]> {
    const propias = this.config.unidades.filter((u) => puedeDespachar(cadId, u.cadId));
    const activos = await this.almacen.reportesPorCad([...new Set(propias.map((u) => u.cadId).concat(cadId))], true);
    const ocupadas = new Set(activos.filter((r) => r.unidad).map((r) => r.unidad!.unidadId));
    return propias
      .map((u) => ({ unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, disponible: !ocupadas.has(u.unidadId), posicion: this.avl.posicion(u.unidadId) }));
  }

  /** La más cercana por ruta: preselecciona por línea recta y calcula la ruta de las 3 mejores. */
  private async masCercana(r: Reporte) {
    const previas = candidatasPorCercania(await this.disponiblesConGps(r.cadId), r.ubicacion, r.canalizacion.corporaciones[0]).slice(0, 3);
    if (!previas.length) return null;
    const conRuta = await Promise.all(previas.map(async (c) => ({ ...c, ruta: await this.rutas.ruta(c.unidad.posicion!, r.ubicacion) })));
    const delTipo = conRuta.filter((c) => c.delTipo);
    return (delTipo.length ? delTipo : conRuta).sort((a, b) => a.ruta.segundos - b.ruta.segundos)[0];
  }

  @Post('reportes/:folio/acciones')
  @HttpCode(200)
  @UseGuards(OperadorGuard)
  async accion(@Req() req: { operador: OperadorSesion }, @Param('folio') folio: string, @Body(new ZodPipe(AccionSchema)) body: Accion) {
    const op = req.operador;
    const actual = await this.almacen.reporte(folio);
    if (!actual || !puedeVer(op, actual.cadId)) throw new NotFoundException({ codigo: 'folio_no_encontrado' });
    const cadId = actual.cadId;
    if (!consolaOpera(this.config, cadId)) throw new ConflictException({ codigo: 'cad_con_sistema_propio', mensaje: 'Este CAD despacha en su propio sistema; la consola solo lo muestra.' });

    let accion: Accion = body;
    if (body.accion === 'asignar_cercana') {
      const c = await this.masCercana(actual);
      if (!c) throw new ConflictException({ codigo: 'sin_unidades_disponibles', mensaje: 'No hay unidades disponibles con GPS en este CAD.' });
      accion = { accion: 'asignar', unidadId: c.unidad.unidadId, etaMinutos: minutosDe(c.ruta.segundos) };
    }
    const ev = this.evento(folio, cadId, op, accion);
    await this.eventos.procesar(cadId, ev, {
      actor: `operador:${op.usuario}`,
      secuenciaSiguiente: true,
      antes: (r) => {
        // La clasificación se puede corregir aun cerrado el reporte (sirve a la estadística).
        if (ESTADOS_FINALES.includes(r.estado) && body.accion !== 'reclasificar') throw new ConflictException({ codigo: 'reporte_cerrado' });
        if (body.accion === 'recibir' && r.estado !== 'recibido' && r.estado !== 'transferido') throw new ConflictException({ codigo: 'ya_recibido' });
      },
    });
    if (body.accion === 'transferir') await this.avisarDestino(folio, body.cadDestinoId);
    // Asignación automática: al recibir, se asigna sola la unidad más cercana (el operador puede cambiarla).
    if (body.accion === 'recibir' && this.config.asignacionAutomatica) {
      const r = (await this.almacen.reporte(folio))!;
      const c = await this.masCercana(r);
      if (c) {
        await this.eventos.procesar(cadId, this.evento(folio, cadId, op, { accion: 'asignar', unidadId: c.unidad.unidadId, etaMinutos: minutosDe(c.ruta.segundos) }), {
          actor: 'sistema:asignacion_automatica',
          secuenciaSiguiente: true,
        });
      }
    }
    return this.vista((await this.almacen.reporte(folio))!);
  }

  /**
   * Una transferencia hecha en la consola la tiene que conocer el CAD destino:
   * se le manda el alta completa (por webhook o a su bandeja de consola).
   */
  private avisarDestino(folio: string, cadDestinoId: string) {
    return this.almacen.conReporte(folio, async () => {
      const r = await this.almacen.reporte(folio);
      const ciudadano = r && (await this.almacen.ciudadano(r.ciudadanoId));
      if (!r || !ciudadano || r.cadId !== cadDestinoId) return;
      const e = r.escenarioId ? (await this.almacen.perfil(r.ciudadanoId)).escenarios.find((x) => x.id === r.escenarioId) : undefined;
      await this.despachador.enviarCreado(r, ciudadano, e && { id: e.id, titulo: e.titulo });
      await this.almacen.guardarReporte(r);
    });
  }

  private evento(folio: string, cadId: string, op: OperadorSesion, a: Accion): EventoDesdeCad {
    const base = { eventoId: randomUUID(), folio, secuencia: 0, ocurridoEn: new Date().toISOString() };
    switch (a.accion) {
      case 'recibir':
        return { ...base, tipo: 'incidente.recibido', datos: { folioCad: folio, operador: op.nombre } };
      case 'asignar_cercana':
        throw new BadRequestException({ codigo: 'accion_invalida' });
      case 'asignar': {
        const u = this.config.unidades.find((x) => x.unidadId === a.unidadId && puedeDespachar(cadId, x.cadId));
        if (!u) throw new BadRequestException({ codigo: 'unidad_desconocida' });
        return { ...base, tipo: 'unidad.asignada', datos: { unidadId: u.unidadId, corporacion: u.corporacion, etiqueta: u.etiqueta, etaMinutos: a.etaMinutos } };
      }
      case 'estado':
        return { ...base, tipo: 'incidente.estado', datos: { estado: a.estado, nota: a.nota } };
      case 'mensaje':
        return { ...base, tipo: 'mensaje.operador', datos: { texto: a.texto, autor: op.nombre } };
      case 'reclasificar':
        return { ...base, tipo: 'incidente.reclasificado', datos: { codigoCnie: a.codigoCnie, codigoCnieSecundario: a.codigoCnieSecundario, motivo: a.motivo, operador: op.nombre } };
      case 'transferir':
        if (a.cadDestinoId === cadId || !CADS_CONOCIDOS.some((c) => c.id === a.cadDestinoId)) throw new BadRequestException({ codigo: 'cad_destino_invalido' });
        return { ...base, tipo: 'incidente.transferido', datos: { cadDestinoId: a.cadDestinoId, motivo: a.motivo } };
    }
  }

  private yoDe(op: OperadorSesion) {
    return {
      operador: op,
      cads: CADS_CONOCIDOS.map((c) => ({ ...c, modo: consolaOpera(this.config, c.id) ? 'consola' : 'webhook', mio: puedeVer(op, c.id) })),
      protocolo: { version: this.protocolos.vigente().version, estado: this.protocolos.vigente().estado },
    };
  }

  async vista(r: Reporte) {
    return vistaOperador(r, await this.almacen.ciudadano(r.ciudadanoId), this.protocolos.vigente(), this.config, this.despachador);
  }
}

const promedio = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
