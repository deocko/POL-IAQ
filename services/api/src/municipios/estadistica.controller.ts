import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  CAD_IDS, METAS_PROVISIONALES, cerrarMes, csvAjustesSesnsp, csvFolios, csvSesnsp, enRango, estadistica, estadisticaPublica, mesLocal, xlsxSesnsp,
  type CierreMensual, type FilaEstadistica,
} from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import { OperadorGuard, puedeVer, type OperadorSesion } from '../operador/operador.guard';
import { filaEstadistica, filtrarFilas, limitesUtc, rangoDe, type FiltroEstadistica } from './filas';

const MES = /^\d{4}-\d{2}$/;
const esSupervision = (op: OperadorSesion) => op.cads.includes('*');

function descargar(res: Response, nombre: string, tipo: string, cuerpo: string | Uint8Array) {
  res.setHeader('content-type', tipo);
  res.setHeader('content-disposition', `attachment; filename="${nombre}"`);
  res.send(typeof cuerpo === 'string' ? cuerpo : Buffer.from(cuerpo));
}

/**
 * Reportes y estadística por municipio. Son los mismos en Modo A y Modo B porque salen de los
 * folios: volumen, tiempos y quejas por municipio (clave INEGI de 5 dígitos), CNIE, corporación
 * y unidad; exportación CSV por periodo y el reporte mensual al SESNSP.
 */
@Controller('v1/operador')
@UseGuards(OperadorGuard)
export class EstadisticaController {
  constructor(@Inject(Almacen) private readonly almacen: Almacen) {}

  private async filas(op: OperadorSesion, f: FiltroEstadistica) {
    if (f.cadId && (!CAD_IDS.includes(f.cadId) || !puedeVer(op, f.cadId))) throw new NotFoundException({ codigo: 'cad_no_encontrado' });
    const rango = rangoDe(f);
    const [desde, hasta] = limitesUtc(rango.desde, rango.hasta);
    const todos = await this.almacen.reportesEntre(op.cads, desde, hasta);
    return { rango, filas: filtrarFilas(todos.map(filaEstadistica), f, rango) };
  }

  /** Volumen, tiempos y quejas, con desgloses. Filtros: cadId, municipio (22001–22018), periodo + fecha, o desde/hasta. */
  @Get('estadistica')
  async estadistica(@Req() req: { operador: OperadorSesion }, @Query() q: FiltroEstadistica) {
    const { rango, filas } = await this.filas(req.operador, q);
    return { periodo: rango, filtros: { cadId: q.cadId ?? null, municipio: q.municipio ?? null }, metas: METAS_PROVISIONALES, ...estadistica(filas) };
  }

  /** Un renglón por folio, sin datos personales (para Excel o el C5). */
  @Get('estadistica/folios.csv')
  async foliosCsv(@Req() req: { operador: OperadorSesion }, @Query() q: FiltroEstadistica, @Res() res: Response) {
    const { rango, filas } = await this.filas(req.operador, q);
    const nombre = `poliaq-folios-${q.municipio ?? q.cadId ?? 'todos'}-${(rango.desde ?? 'inicio')}_${(rango.hasta ?? 'hoy')}.csv`;
    descargar(res, nombre, 'text/csv; charset=utf-8', csvFolios(filas));
  }

  // ── Reporte mensual al SESNSP (solo supervisión: es estatal) ─────────────

  private supervision(op: OperadorSesion) {
    if (!esSupervision(op)) throw new ForbiddenException({ codigo: 'solo_supervision', mensaje: 'El reporte al SESNSP lo genera supervisión (CQ CIAS).' });
  }

  private async delMes(mes: string): Promise<FilaEstadistica[]> {
    const desde = `${mes}-01`;
    const [a, m] = mes.split('-').map(Number);
    const hasta = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    const [d, h] = limitesUtc(desde, hasta);
    return (await this.almacen.reportesEntre(['*'], d, h)).map(filaEstadistica).filter((f) => enRango(f.creadoEn, desde, hasta));
  }

  /** Estado de hoy de los folios de meses ya cerrados (para los ajustes). */
  private async actuales(cierres: CierreMensual[]) {
    const folios = new Set(cierres.flatMap((c) => Object.keys(c.foto)));
    const mapa = new Map<string, FilaEstadistica>();
    for (const folio of folios) {
      const r = await this.almacen.reporte(folio);
      if (r) mapa.set(folio, filaEstadistica(r));
    }
    return mapa;
  }

  /** Borrador del mes (lo que saldría si se cerrara ahora), sin guardar nada. */
  private async borrador(mes: string, quien: string) {
    const cierres = await this.almacen.cierresSesnsp();
    const actuales = await this.actuales(cierres);
    return cerrarMes(mes, await this.delMes(mes), cierres, (f) => actuales.get(f), quien);
  }

  private validarMes(mes: string) {
    if (!MES.test(mes)) throw new BadRequestException({ codigo: 'mes_invalido', mensaje: 'Usa AAAA-MM.' });
  }

  @Get('sesnsp')
  async sesnsp(@Req() req: { operador: OperadorSesion }) {
    this.supervision(req.operador);
    const cierres = await this.almacen.cierresSesnsp();
    return {
      mesActual: mesLocal(new Date().toISOString()),
      cierres: cierres.map((c) => ({ mes: c.mes, cerradoEn: c.cerradoEn, cerradoPor: c.cerradoPor, filas: c.filas.length, total: c.filas.reduce((n, f) => n + f.total, 0), ajustes: c.ajustes.length })),
      nota: 'Columnas según lo pedido por POL-IAQ; el formato oficial del CNI/SESNSP está por confirmar con el CQ CIAS.',
    };
  }

  /** El cierre guardado, o el borrador si el mes sigue abierto. */
  @Get('sesnsp/:mes')
  async mes(@Req() req: { operador: OperadorSesion }, @Param('mes') mes: string) {
    this.supervision(req.operador);
    this.validarMes(mes);
    const cerrado = (await this.almacen.cierresSesnsp()).find((c) => c.mes === mes);
    if (cerrado) return { estado: 'cerrado', ...sinFoto(cerrado) };
    const b = await this.borrador(mes, req.operador.usuario);
    return { estado: 'borrador', ...sinFoto(b), cerradoEn: null, cerradoPor: null };
  }

  /** Congela el mes. Solo meses ya terminados; un mes cerrado no se vuelve a cerrar ni se reescribe. */
  @Post('sesnsp/:mes/cerrar')
  @HttpCode(200)
  async cerrar(@Req() req: { operador: OperadorSesion }, @Param('mes') mes: string) {
    this.supervision(req.operador);
    this.validarMes(mes);
    if (mes >= mesLocal(new Date().toISOString())) throw new ConflictException({ codigo: 'mes_en_curso', mensaje: 'Solo se cierran meses terminados.' });
    let c: CierreMensual;
    try { c = await this.borrador(mes, req.operador.usuario); } catch { throw new ConflictException({ codigo: 'mes_ya_cerrado' }); }
    if (!(await this.almacen.guardarCierreSesnsp(c))) throw new ConflictException({ codigo: 'mes_ya_cerrado' });
    await this.almacen.auditar({ actor: `operador:${req.operador.usuario}`, accion: 'sesnsp_mes_cerrado', detalle: { mes, filas: c.filas.length, ajustes: c.ajustes.length } });
    return { estado: 'cerrado', ...sinFoto(c) };
  }

  @Get('sesnsp/:mes/:archivo')
  async archivo(@Req() req: { operador: OperadorSesion }, @Param('mes') mes: string, @Param('archivo') archivo: string, @Res() res: Response) {
    this.supervision(req.operador);
    this.validarMes(mes);
    const cerrado = (await this.almacen.cierresSesnsp()).find((x) => x.mes === mes);
    const c = cerrado ?? (await this.borrador(mes, req.operador.usuario));
    const sufijo = cerrado ? '-cerrado' : '-borrador';
    if (archivo === 'reporte.csv') return descargar(res, `sesnsp-${mes}${sufijo}.csv`, 'text/csv; charset=utf-8', csvSesnsp(c));
    if (archivo === 'ajustes.csv') return descargar(res, `sesnsp-${mes}-ajustes${sufijo}.csv`, 'text/csv; charset=utf-8', csvAjustesSesnsp(c));
    if (archivo === 'reporte.xlsx') return descargar(res, `sesnsp-${mes}${sufijo}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxSesnsp(c));
    throw new NotFoundException({ codigo: 'archivo_desconocido' });
  }
}

const sinFoto = ({ foto: _foto, ...c }: CierreMensual) => c;

/** Versión pública agregada: sin folios, ubicaciones, unidades ni datos personales. */
@Controller('v1/publico')
export class PublicoController {
  constructor(@Inject(Almacen) private readonly almacen: Almacen) {}

  @Get('tiempos')
  async tiempos(@Query('periodo') periodo = 'mensual', @Query('fecha') fecha?: string) {
    const rango = rangoDe({ periodo, fecha });
    const [d, h] = limitesUtc(rango.desde, rango.hasta);
    const filas = (await this.almacen.reportesEntre(['*'], d, h)).map(filaEstadistica).filter((f) => enRango(f.creadoEn, rango.desde, rango.hasta));
    return estadisticaPublica(filas, { desde: rango.desde!, hasta: rango.hasta!, etiqueta: rango.etiqueta });
  }
}

