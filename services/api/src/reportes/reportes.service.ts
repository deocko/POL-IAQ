import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  enrutarPorUbicacion, generarFolio, incidentePorId, puedeTransicionar, ESTADOS_FINALES,
  type CrearReporte, type EstadoIncidente, type SolicitarEvidencia,
} from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import type { Ciudadano, Evidencia, Reporte } from '../almacen/modelos';
import { BusService } from '../comun/bus.service';
import { CONFIG, type Config } from '../config';
import { DespachadorCadService } from '../cad/despachador.service';

@Injectable()
export class ReportesService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(BusService) private readonly bus: BusService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
  ) {}

  async crear(ciudadano: Ciudadano, datos: CrearReporte): Promise<Reporte> {
    const incidente = incidentePorId(datos.incidenteId);
    if (!incidente) throw new BadRequestException({ codigo: 'incidente_desconocido' });

    const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
    if ((await this.almacen.contarReportesDesde(ciudadano.id, haceUnaHora)) >= this.config.maxReportesPorHora) {
      throw new HttpException({ codigo: 'limite_reportes', mensaje: 'Alcanzaste el límite de reportes por hora. Si es una emergencia, llama al 911.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const ruta = enrutarPorUbicacion(datos.ubicacion.lat, datos.ubicacion.lng);
    const ahora = new Date();
    const clave = ruta.municipio?.claveInegi ?? null;
    const folio = generarFolio(clave, ahora.getUTCFullYear(), await this.almacen.siguienteConsecutivo(clave ?? '000', ahora.getUTCFullYear()));
    const iso = ahora.toISOString();

    const reporte: Reporte = {
      folio,
      ciudadanoId: ciudadano.id,
      incidenteId: incidente.id,
      codigoCnie: incidente.codigoCnie,
      prioridad: datos.esPanico ? 'alta' : incidente.prioridad,
      corporacionSugerida: incidente.corporacionSugerida,
      ubicacion: datos.ubicacion,
      municipioClave: clave,
      cadId: ruta.cadId,
      descripcion: datos.descripcion,
      respuestas: datos.respuestas,
      esPanico: datos.esPanico,
      ocultarIdentidadAUnidad: datos.ocultarIdentidadAUnidad,
      estado: 'recibido',
      evidencias: [],
      mensajes: [],
      historial: [{ estado: 'recibido', en: iso }],
      creadoEn: iso,
      actualizadoEn: iso,
      secuenciaSalida: 0,
      secuenciaEntrada: 0,
    };
    await this.almacen.guardarReporte(reporte);
    await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'reporte_creado', folio, detalle: { cadId: ruta.cadId } });
    // El envío al CAD modifica la secuencia de salida: va con el reporte bloqueado.
    return this.almacen.conReporte(folio, async () => {
      const r = (await this.almacen.reporte(folio))!;
      await this.despachador.enviarCreado(r, ciudadano);
      await this.almacen.guardarReporte(r);
      return r;
    });
  }

  listar(ciudadano: Ciudadano) {
    return this.almacen.reportesDe(ciudadano.id);
  }

  async delCiudadano(ciudadano: Ciudadano, folio: string): Promise<Reporte> {
    const r = await this.almacen.reporte(folio);
    if (!r) throw new NotFoundException({ codigo: 'folio_no_encontrado' });
    if (r.ciudadanoId !== ciudadano.id) throw new ForbiddenException({ codigo: 'folio_ajeno' });
    return r;
  }

  /** Bloquea el folio, lo carga, verifica que sea del ciudadano y aplica `fn`. */
  private delCiudadanoBloqueado<T>(ciudadano: Ciudadano, folio: string, fn: (r: Reporte) => Promise<T>) {
    return this.almacen.conReporte(folio, async () => fn(await this.delCiudadano(ciudadano, folio)));
  }

  /** Solo cambia el objeto; quien llama debe guardarlo con `tocar`. */
  cambiarEstado(r: Reporte, estado: EstadoIncidente, nota?: string) {
    if (r.estado === estado) return;
    if (!puedeTransicionar(r.estado, estado)) throw new ConflictException({ codigo: 'transicion_invalida', desde: r.estado, hacia: estado });
    r.estado = estado;
    r.historial.push({ estado, en: new Date().toISOString(), nota });
  }

  cancelar(ciudadano: Ciudadano, folio: string) {
    return this.delCiudadanoBloqueado(ciudadano, folio, async (r) => {
      if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
      this.cambiarEstado(r, 'cancelado', 'Cancelado por el ciudadano');
      await this.despachador.enviarActualizado(r, { cancelado: true });
      await this.tocar(r);
      return r;
    });
  }

  agregarMensaje(ciudadano: Ciudadano, folio: string, texto: string) {
    return this.delCiudadanoBloqueado(ciudadano, folio, async (r) => {
      if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
      r.mensajes.push({ id: randomUUID(), autor: 'ciudadano', texto, en: new Date().toISOString() });
      await this.despachador.enviarActualizado(r, { mensajeCiudadano: texto });
      await this.tocar(r);
      return r;
    });
  }

  /** Registra la evidencia y devuelve a dónde subir el archivo. */
  solicitarEvidencia(ciudadano: Ciudadano, folio: string, datos: SolicitarEvidencia) {
    return this.delCiudadanoBloqueado(ciudadano, folio, async (r) => {
      if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
      const id = randomUUID();
      r.evidencias.push({ id, tipo: datos.tipo, mimeType: datos.mimeType, bytes: datos.bytes, sha256Declarado: datos.sha256, estado: 'pendiente', capturadoEn: datos.capturadoEn, ubicacion: datos.ubicacion });
      await this.tocar(r);
      // TODO(fase 2): URL prefirmada del almacén de objetos (S3 con Object Lock / WORM).
      return { evidenciaId: id, subirA: `${this.config.urlPublica}/v1/reportes/${folio}/evidencias/${id}/contenido`, metodo: 'PUT' as const };
    });
  }

  /** Recibe el archivo, verifica el hash (cadena de custodia) y lo avisa al CAD. */
  async recibirContenido(ciudadano: Ciudadano, folio: string, evidenciaId: string, datos: Buffer): Promise<Evidencia> {
    // El rechazo se guarda (queda en la bitácora) y el error se lanza fuera de
    // la transacción para que no se deshaga.
    const res = await this.delCiudadanoBloqueado(ciudadano, folio, async (r) => {
      const e = r.evidencias.find((x) => x.id === evidenciaId);
      if (!e) throw new NotFoundException({ codigo: 'evidencia_no_encontrada' });
      if (e.estado !== 'pendiente') throw new ConflictException({ codigo: 'evidencia_ya_recibida' });
      const sha = createHash('sha256').update(datos).digest('hex');
      e.sha256Servidor = sha;
      e.recibidoEn = new Date().toISOString();
      if (sha !== e.sha256Declarado || datos.length !== e.bytes) {
        e.estado = 'rechazada';
        await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'evidencia_rechazada', folio, detalle: { evidenciaId, sha } });
        await this.tocar(r);
        return { rechazada: true as const };
      }
      e.estado = 'verificada';
      await this.tocar(r);
      await this.almacen.guardarContenido(e.id, datos);
      await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'evidencia_recibida', folio, detalle: { evidenciaId, sha } });
      await this.despachador.enviarActualizado(r, { nuevaEvidencia: [this.despachador.enlaceEvidencia(r, e)] });
      await this.almacen.guardarReporte(r);
      return { rechazada: false as const, evidencia: e };
    });
    if (res.rechazada) throw new BadRequestException({ codigo: 'hash_no_coincide' });
    return res.evidencia;
  }

  /** Guarda el reporte y avisa en tiempo real al ciudadano. */
  async tocar(r: Reporte) {
    r.actualizadoEn = new Date().toISOString();
    await this.almacen.guardarReporte(r);
    this.bus.reporteCambio(r);
  }
}
