import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  enrutarPorUbicacion, generarFolio, incidentePorId, puedeTransicionar, ESTADOS_FINALES,
  type CrearReporte, type EstadoIncidente, type SolicitarEvidencia,
} from '@pol-iaq/shared';
import { AlmacenService } from '../almacen/almacen.service';
import type { Ciudadano, Reporte } from '../almacen/modelos';
import { BusService } from '../comun/bus.service';
import { CONFIG, type Config } from '../config';
import { DespachadorCadService } from '../cad/despachador.service';

@Injectable()
export class ReportesService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AlmacenService) private readonly almacen: AlmacenService,
    @Inject(BusService) private readonly bus: BusService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
  ) {}

  crear(ciudadano: Ciudadano, datos: CrearReporte): Reporte {
    const incidente = incidentePorId(datos.incidenteId);
    if (!incidente) throw new BadRequestException({ codigo: 'incidente_desconocido' });

    const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
    if (this.almacen.reportesDesde(ciudadano.id, haceUnaHora).length >= this.config.maxReportesPorHora) {
      throw new HttpException({ codigo: 'limite_reportes', mensaje: 'Alcanzaste el límite de reportes por hora. Si es una emergencia, llama al 911.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const ruta = enrutarPorUbicacion(datos.ubicacion.lat, datos.ubicacion.lng);
    const ahora = new Date();
    const clave = ruta.municipio?.claveInegi ?? null;
    const folio = generarFolio(clave, ahora.getUTCFullYear(), this.almacen.siguienteConsecutivo(clave ?? '000', ahora.getUTCFullYear()));
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
    this.almacen.guardarReporte(reporte);
    this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'reporte_creado', folio, detalle: { cadId: ruta.cadId } });
    this.despachador.enviarCreado(reporte, ciudadano);
    return reporte;
  }

  listar(ciudadano: Ciudadano) {
    return this.almacen.reportesDe(ciudadano.id);
  }

  delCiudadano(ciudadano: Ciudadano, folio: string): Reporte {
    const r = this.almacen.reporte(folio);
    if (!r) throw new NotFoundException({ codigo: 'folio_no_encontrado' });
    if (r.ciudadanoId !== ciudadano.id) throw new ForbiddenException({ codigo: 'folio_ajeno' });
    return r;
  }

  cambiarEstado(r: Reporte, estado: EstadoIncidente, nota?: string) {
    if (r.estado === estado) return;
    if (!puedeTransicionar(r.estado, estado)) throw new ConflictException({ codigo: 'transicion_invalida', desde: r.estado, hacia: estado });
    r.estado = estado;
    r.historial.push({ estado, en: new Date().toISOString(), nota });
    this.tocar(r);
  }

  cancelar(ciudadano: Ciudadano, folio: string) {
    const r = this.delCiudadano(ciudadano, folio);
    if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
    this.cambiarEstado(r, 'cancelado', 'Cancelado por el ciudadano');
    this.despachador.enviarActualizado(r, { cancelado: true });
    return r;
  }

  agregarMensaje(ciudadano: Ciudadano, folio: string, texto: string) {
    const r = this.delCiudadano(ciudadano, folio);
    if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
    r.mensajes.push({ id: randomUUID(), autor: 'ciudadano', texto, en: new Date().toISOString() });
    this.tocar(r);
    this.despachador.enviarActualizado(r, { mensajeCiudadano: texto });
    return r;
  }

  /** Registra la evidencia y devuelve a dónde subir el archivo. */
  solicitarEvidencia(ciudadano: Ciudadano, folio: string, datos: SolicitarEvidencia) {
    const r = this.delCiudadano(ciudadano, folio);
    if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
    const id = randomUUID();
    r.evidencias.push({ id, tipo: datos.tipo, mimeType: datos.mimeType, bytes: datos.bytes, sha256Declarado: datos.sha256, estado: 'pendiente', capturadoEn: datos.capturadoEn, ubicacion: datos.ubicacion });
    this.tocar(r);
    // TODO(fase 1): URL prefirmada del almacén de objetos (S3 con Object Lock / WORM).
    return { evidenciaId: id, subirA: `${this.config.urlPublica}/v1/reportes/${folio}/evidencias/${id}/contenido`, metodo: 'PUT' };
  }

  /** Recibe el archivo, verifica el hash (cadena de custodia) y lo avisa al CAD. */
  recibirContenido(ciudadano: Ciudadano, folio: string, evidenciaId: string, datos: Buffer) {
    const r = this.delCiudadano(ciudadano, folio);
    const e = r.evidencias.find((x) => x.id === evidenciaId);
    if (!e) throw new NotFoundException({ codigo: 'evidencia_no_encontrada' });
    if (e.estado !== 'pendiente') throw new ConflictException({ codigo: 'evidencia_ya_recibida' });
    const sha = createHash('sha256').update(datos).digest('hex');
    e.sha256Servidor = sha;
    e.recibidoEn = new Date().toISOString();
    if (sha !== e.sha256Declarado || datos.length !== e.bytes) {
      e.estado = 'rechazada';
      this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'evidencia_rechazada', folio, detalle: { evidenciaId, sha } });
      this.tocar(r);
      throw new BadRequestException({ codigo: 'hash_no_coincide' });
    }
    e.estado = 'verificada';
    this.almacen.guardarContenido(e.id, datos);
    this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'evidencia_recibida', folio, detalle: { evidenciaId, sha } });
    this.tocar(r);
    this.despachador.enviarActualizado(r, { nuevaEvidencia: [this.despachador.enlaceEvidencia(r, e)] });
    return e;
  }

  tocar(r: Reporte) {
    r.actualizadoEn = new Date().toISOString();
    this.almacen.guardarReporte(r);
    this.bus.reporteCambio(r);
  }
}
