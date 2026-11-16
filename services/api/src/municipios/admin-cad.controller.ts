import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CAD_IDS, CASOS_PRUEBA_CAD, municipioPorCad, type AltaCad, type CasoPruebaCad } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import { BusService } from '../comun/bus.service';
import { ZodPipe } from '../comun/zod.pipe';
import { DespachadorCadService } from '../cad/despachador.service';
import { CONFIG, type Config } from '../config';
import { OperadorGuard, type OperadorSesion } from '../operador/operador.guard';
import { RegistroCadService } from './registro-cad.service';

const CasoSchema = z.object({ ok: z.boolean(), detalle: z.string().max(1000).optional() });
const EstadoSchema = z.object({ estado: z.enum(['pruebas', 'activo', 'suspendido']), motivo: z.string().max(500).optional() });
const MigrarSchema = z.object({ webhookUrl: z.url(), secreto: z.string().min(32).max(200).optional() });
const ReenviarSchema = z.object({ folio: z.string().min(1) });

/**
 * Alta de municipios (onboarding de CAD). Solo supervisión (operadores con `*`).
 * Ver docs/interconexion/ALTA-MUNICIPIO.md.
 */
@Controller('v1/admin')
@UseGuards(OperadorGuard)
export class AdminCadController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(RegistroCadService) private readonly registro: RegistroCadService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
    @Inject(BusService) private readonly bus: BusService,
  ) {}

  private quien(req: { operador: OperadorSesion }) {
    if (!req.operador.cads.includes('*')) throw new ForbiddenException({ codigo: 'solo_supervision' });
    return `operador:${req.operador.usuario}`;
  }

  private cad(cadId: string) {
    if (!CAD_IDS.includes(cadId)) throw new NotFoundException({ codigo: 'cad_desconocido' });
    return cadId;
  }

  @Get('cads')
  lista(@Req() req: { operador: OperadorSesion }) {
    this.quien(req);
    return { cads: this.registro.lista(), casos: CASOS_PRUEBA_CAD, ambiente: this.config.produccion ? 'produccion' : 'pruebas' };
  }

  /** Detalle con el polígono vigente (propio o INEGI 2022). */
  @Get('cads/:cadId')
  detalle(@Req() req: { operador: OperadorSesion }, @Param('cadId') cadId: string) {
    this.quien(req);
    const m = municipioPorCad(this.cad(cadId));
    return { ...this.registro.vista(cadId), poligono: m ? this.registro.geocerca(m) : null };
  }

  @Put('cads/:cadId')
  guardar(@Req() req: { operador: OperadorSesion }, @Param('cadId') cadId: string, @Body() body: Omit<AltaCad, 'cadId'>) {
    const quien = this.quien(req);
    return this.registro.guardar({ ...body, cadId: this.cad(cadId) } as AltaCad, quien);
  }

  @Post('cads/:cadId/casos/:caso')
  @HttpCode(200)
  caso(@Req() req: { operador: OperadorSesion }, @Param('cadId') cadId: string, @Param('caso') caso: string, @Body(new ZodPipe(CasoSchema)) body: z.infer<typeof CasoSchema>) {
    return this.registro.registrarCaso(this.cad(cadId), caso as CasoPruebaCad, body.ok, body.detalle, this.quien(req));
  }

  @Post('cads/:cadId/estado')
  @HttpCode(200)
  estado(@Req() req: { operador: OperadorSesion }, @Param('cadId') cadId: string, @Body(new ZodPipe(EstadoSchema)) body: z.infer<typeof EstadoSchema>) {
    return this.registro.cambiarEstado(this.cad(cadId), body.estado, this.quien(req), body.motivo);
  }

  /**
   * Modo B → Modo A sin perder nada: mismos folios, CNIE e historial. Los folios en curso se le
   * reenvían al CAD como `incidente.creado` con `estadoActual`, y el CAD sigue desde ahí.
   */
  @Post('cads/:cadId/migrar')
  @HttpCode(200)
  async migrar(@Req() req: { operador: OperadorSesion }, @Param('cadId') cadId: string, @Body(new ZodPipe(MigrarSchema)) body: z.infer<typeof MigrarSchema>) {
    const quien = this.quien(req);
    const folios = await this.registro.migrarAModoA(this.cad(cadId), body, quien);
    for (const folio of folios) {
      await this.almacen.conReporte(folio, async () => {
        const r = await this.almacen.reporte(folio);
        const ciudadano = r && (await this.almacen.ciudadano(r.ciudadanoId));
        if (!r || !ciudadano || r.cadId !== cadId) return;
        // El CAD empieza su propia secuencia de eventos, como tras una transferencia.
        r.secuenciaEntrada = 0;
        const e = r.escenarioId ? (await this.almacen.perfil(r.ciudadanoId)).escenarios.find((x) => x.id === r.escenarioId) : undefined;
        await this.despachador.enviarCreado(r, ciudadano, e && { id: e.id, titulo: e.titulo }, { conEstadoActual: true });
        await this.almacen.guardarReporte(r);
        await this.almacen.auditar({ actor: quien, accion: 'reenviado_por_migracion', folio, detalle: { cadId, estado: r.estado } });
        this.bus.reporteCambio(r, cadId);
      });
    }
    return { ...this.registro.vista(cadId), foliosReenviados: folios };
  }

  /** Envíos de un folio a su CAD (intentos y estado): sirve al caso «caída del webhook con reintentos». */
  @Get('cads/:cadId/bandeja')
  async bandeja(@Req() req: { operador: OperadorSesion }, @Query('folio') folio: string) {
    this.quien(req);
    if (!folio) throw new BadRequestException({ codigo: 'falta_folio' });
    return { envios: (await this.almacen.enviosDe(folio)).map((e) => ({ cadId: e.cadId, eventoId: e.evento.eventoId, tipo: e.evento.tipo, secuencia: e.evento.secuencia, intentos: e.intentos, estado: e.estado })) };
  }

  /** Reentrega `incidente.creado` con el mismo eventoId (caso «evento duplicado»). Solo CAD en pruebas o fuera de producción. */
  @Post('cads/:cadId/reenviar')
  @HttpCode(202)
  async reenviar(@Req() req: { operador: OperadorSesion }, @Param('cadId') cadId: string, @Body(new ZodPipe(ReenviarSchema)) body: z.infer<typeof ReenviarSchema>) {
    const quien = this.quien(req);
    if (this.config.produccion && this.config.cads[cadId]?.estado !== 'pruebas') throw new ConflictException({ codigo: 'solo_en_pruebas' });
    const envio = (await this.almacen.enviosDe(body.folio)).find((e) => e.cadId === cadId && e.evento.tipo === 'incidente.creado');
    if (!envio) throw new NotFoundException({ codigo: 'envio_no_encontrado' });
    await this.despachador.reentregar(envio);
    await this.almacen.auditar({ actor: quien, accion: 'evento_reentregado', folio: body.folio, detalle: { cadId, eventoId: envio.evento.eventoId } });
    return { eventoId: envio.evento.eventoId };
  }

  /** Bitácora de un folio (acciones, no datos personales). */
  @Get('auditoria')
  async auditoria(@Req() req: { operador: OperadorSesion }, @Query('folio') folio: string) {
    this.quien(req);
    if (!folio) throw new BadRequestException({ codigo: 'falta_folio' });
    return { entradas: (await this.almacen.auditoria(folio)).map((a) => ({ en: a.en, actor: a.actor, accion: a.accion })) };
  }
}
