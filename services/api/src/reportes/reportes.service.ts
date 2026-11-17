import { type OnModuleInit, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  canalizar, clasificacionDe, clasificarCnie, esQueja, permiteAnonimo, generarFolio, incidentePorId, puedeTransicionar, resolverEntradas, respuestasDe,
  validarCodigoCnie, ESTADOS_FINALES, esMalUso, tipoCnie, type ClasificacionCnie, type TipoTelefono,
  type CrearReporte, type EntradaGuardada, type EstadoIncidente, type IncidenteCatalogo, type Opinion, type Prioridad, type ResponderCuestionario, type SolicitarEvidencia, rutaDe, textoRespaldo } from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import type { Ciudadano, Evidencia, Reporte } from '../almacen/modelos';
import { BusService } from '../comun/bus.service';
import { CONFIG, type Config } from '../config';
import { DespachadorCadService } from '../cad/despachador.service';
import { ProtocolosService } from '../protocolos/protocolos.service';
import { RegistroCadService } from '../municipios/registro-cad.service';

const ORDEN: Record<Prioridad, number> = { baja: 0, media: 1, alta: 2 };

/** Alta de una llamada al 911 desde la consola. */
export interface AltaPor911 { operador: string; operadorNombre: string; tipoTelefono: TipoTelefono; prioridad?: Prioridad; codigoCnie?: string }

/** Recatalogar a Mal Uso del servicio (tipo 7) exige un motivo corto (lo pide el Mensaje 11). */
export function exigirMotivoMalUso(datos: { codigoCnie: string; motivo?: string }) {
  if (!esMalUso(datos.codigoCnie)) return;
  const m = datos.motivo?.trim() ?? '';
  if (m.length < 3) throw new BadRequestException({ codigo: 'motivo_obligatorio', mensaje: 'Recatalogar a Mal Uso del servicio requiere el motivo.' });
  if (m.length > 200) throw new BadRequestException({ codigo: 'motivo_largo', mensaje: 'El motivo debe ser un texto corto (hasta 200 caracteres).' });
}

/** Código más preciso de una clasificación (incidente o, si falta, subtipo). */
export const codigoDe = (c: ClasificacionCnie | null | undefined) => c?.incidente?.codigo ?? c?.subtipo.codigo ?? null;

/** 400 con mensaje claro si el código no es un incidente vigente del CNIE V 3.0. */
export function validarCnieOFallar(codigo: string, campo: string) {
  const v = validarCodigoCnie(codigo);
  if (!v.ok) throw new BadRequestException({ codigo: `cnie_${v.error}`, campo, mensaje: v.mensaje, ...(v.reemplazo && { reemplazo: v.reemplazo }) });
  return v.incidente;
}

@Injectable()
export class ReportesService implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(BusService) private readonly bus: BusService,
    @Inject(DespachadorCadService) private readonly despachador: DespachadorCadService,
    @Inject(ProtocolosService) private readonly protocolos: ProtocolosService,
    @Inject(RegistroCadService) private readonly registro: RegistroCadService,
  ) {}

  async onModuleInit() {
    await this.clasificarSinCnie();
  }

  /**
   * Migración: los folios creados antes del CNIE (o sembrados sin él) se clasifican con la
   * misma regla que uno nuevo (catálogo + respuestas guardadas). "Otra emergencia" sin código
   * queda sin clasificar para que la asigne el operador. Cada cambio queda en la auditoría.
   */
  async clasificarSinCnie(): Promise<number> {
    let n = 0;
    for (const r of await this.almacen.reportesEntre(['*'], null, null)) {
      if (r.cnie) continue;
      const cnie = clasificarCnie(r.incidenteId, { ...respuestasDe(r.cuestionario.entradas), ...r.respuestas });
      if (!cnie) continue;
      await this.almacen.conReporte(r.folio, async () => {
        const actual = await this.almacen.reporte(r.folio);
        if (!actual || actual.cnie) return;
        actual.cnie = cnie;
        actual.codigoCnie = cnie.incidente?.codigo ?? null;
        await this.almacen.guardarReporte(actual);
        await this.almacen.auditar({ actor: 'sistema:migracion_cnie', accion: 'cnie_migrado', folio: r.folio, detalle: { a: codigoDe(cnie) } });
        n++;
      });
    }
    return n;
  }

  /**
   * Alta de un reporte. Desde la app (`alta` sin dar) o, desde la consola, de una llamada al 911
   * capturada por el operador: mismo folio, enrutado, cuestionario e historial, con origen 911.
   */
  async crear(ciudadano: Ciudadano, datos: CrearReporte, alta?: AltaPor911): Promise<Reporte> {
    const incidente = incidentePorId(datos.incidenteId);
    if (!incidente) throw new BadRequestException({ codigo: 'incidente_desconocido' });
    if (datos.codigoCnie) {
      if (incidente.id !== 'otro') {
        throw new BadRequestException({ codigo: 'cnie_no_aplica', mensaje: 'Solo "Otra emergencia" acepta un código CNIE elegido por el ciudadano; las demás opciones ya tienen el suyo.' });
      }
      validarCnieOFallar(datos.codigoCnie, 'codigoCnie');
      // Mal Uso del servicio (tipo 7) solo lo aplica el operador del CAD, al verificar el reporte.
      if (esMalUso(datos.codigoCnie)) throw new BadRequestException({ codigo: 'cnie_solo_operador', mensaje: 'Ese tipo lo aplica solo el operador del CAD.' });
    }
    if (alta?.codigoCnie) {
      validarCnieOFallar(alta.codigoCnie, 'codigoCnie');
      if (esMalUso(alta.codigoCnie)) throw new BadRequestException({ codigo: 'cnie_solo_recatalogar', mensaje: 'Mal Uso del servicio se aplica después de verificar el reporte, con «Recatalogar».' });
    }
    if (datos.identidad === 'seudonimo' && !datos.alias) throw new BadRequestException({ codigo: 'falta_seudonimo' });

    const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
    // El límite por hora protege la app; una llamada al 911 la captura el operador.
    if (!alta && (await this.almacen.contarReportesDesde(ciudadano.id, haceUnaHora)) >= this.config.maxReportesPorHora) {
      throw new HttpException({ codigo: 'limite_reportes', mensaje: 'Alcanzaste el límite de reportes por hora. Si es una emergencia, llama al 911.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Escenario de acceso rápido: sus respuestas previas entran al cuestionario.
    let escenario: { id: string; titulo: string } | undefined;
    const entradas: EntradaGuardada[] = [];
    const protocolo = this.protocolos.vigente();
    if (datos.escenarioId) {
      const e = (await this.almacen.perfil(ciudadano.id)).escenarios.find((x) => x.id === datos.escenarioId);
      if (!e) throw new BadRequestException({ codigo: 'escenario_desconocido' });
      escenario = { id: e.id, titulo: e.titulo };
      const previas = Object.entries(e.respuestasPrevias).map(([preguntaId, respuesta]) => ({ preguntaId, respuesta }));
      entradas.push(...resolverEntradas(protocolo, incidente.id, previas, 'escenario').validas);
    }
    if (datos.cuestionario) entradas.push(...resolverEntradas(protocolo, incidente.id, datos.cuestionario.entradas, datos.cuestionario.via).validas);
    const respuestas = respuestasDe(entradas);
    const todas = { ...datos.respuestas, ...respuestas };
    // El anónimo depende del subtipo CNIE, incluido el que resulta de las respuestas o del código elegido.
    if (datos.identidad === 'anonimo' && !permiteAnonimo(incidente.id, todas, datos.codigoCnie)) {
      throw new BadRequestException({ codigo: 'anonimo_no_permitido', mensaje: 'Para este tipo de emergencia necesitamos poder contactarte. Puedes usar un seudónimo.' });
    }
    const cnie = alta?.codigoCnie ? clasificacionDe(alta.codigoCnie, 'operador') : clasificarCnie(incidente.id, todas, datos.codigoCnie);
    const canalizada = canalizar(protocolo, incidente, respuestas, { asistenciaDirecta: datos.asistenciaDirecta });
    const canalizacion = alta?.prioridad ? { ...canalizada, prioridad: alta.prioridad } : canalizada;
    const notaAlta = alta ? `Alta por llamada al 911 (${alta.tipoTelefono === 'fijo' ? 'teléfono fijo' : 'celular'}), capturada por ${alta.operadorNombre}` : undefined;

    // Anónimo: va por el 089 al CQ CIAS. Sin CAD municipal conectado o sin capacidad, también al CQ CIAS.
    const ruta = this.registro.enrutar(datos.ubicacion.lat, datos.ubicacion.lng, { anonimo: datos.identidad === 'anonimo' });
    const notaRuta = textoRespaldo(ruta) ?? undefined;
    const ahora = new Date();
    // El folio lleva la parte municipal (014); municipioClave, la clave INEGI completa (22014).
    const claveFolio = ruta.municipio?.claveFolio ?? null;
    const clave = ruta.municipio?.clave ?? null;
    const folio = generarFolio(claveFolio, ahora.getUTCFullYear(), await this.almacen.siguienteConsecutivo(claveFolio ?? '000', ahora.getUTCFullYear()));
    const iso = ahora.toISOString();

    const reporte: Reporte = {
      folio,
      ciudadanoId: ciudadano.id,
      incidenteId: incidente.id,
      codigoCnie: cnie?.incidente?.codigo ?? null,
      cnie,
      prioridad: canalizacion.prioridad,
      corporacionSugerida: canalizacion.corporaciones[0],
      ubicacion: datos.ubicacion,
      municipioClave: clave,
      cadId: ruta.cadId,
      descripcion: datos.descripcion,
      respuestas: todas,
      asistenciaDirecta: datos.asistenciaDirecta,
      escenarioId: escenario?.id,
      cuestionario: { protocoloVersion: protocolo.version, protocoloEstado: protocolo.estado, entradas },
      canalizacion,
      ocultarIdentidadAUnidad: datos.ocultarIdentidadAUnidad,
      identidad: datos.identidad,
      ...(datos.identidad === 'seudonimo' && { alias: datos.alias }),
      estado: 'recibido',
      evidencias: [],
      mensajes: [],
      historial: [{ estado: 'recibido', en: iso, ...((notaAlta || notaRuta) && { nota: [notaAlta, notaRuta].filter(Boolean).join('. ') }) }],
      ruta: rutaDe(ruta),
      ...(alta && { origen: '911' as const, tipoTelefono: alta.tipoTelefono, altaPor: alta.operador }),
      creadoEn: iso,
      actualizadoEn: iso,
      secuenciaSalida: 0,
      secuenciaEntrada: 0,
    };
    await this.almacen.guardarReporte(reporte);
    await this.almacen.auditar({ actor: alta ? `operador:${alta.operador}` : `ciudadano:${ciudadano.id}`, accion: alta ? 'reporte_creado_911' : 'reporte_creado', folio, detalle: { cadId: ruta.cadId, motivo: ruta.motivo, canal: ruta.canal, escenarioId: escenario?.id, protocolo: protocolo.version, cnie: cnie?.incidente?.codigo ?? cnie?.subtipo.codigo ?? null, ...(alta && { origen: '911', tipoTelefono: alta.tipoTelefono, ciudadanoId: ciudadano.id }) } });
    // El envío al CAD modifica la secuencia de salida: va con el reporte bloqueado.
    return this.almacen.conReporte(folio, async () => {
      const r = (await this.almacen.reporte(folio))!;
      await this.despachador.enviarCreado(r, ciudadano, escenario);
      await this.almacen.guardarReporte(r);
      this.bus.reporteCambio(r);
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

  /**
   * Agrega respuestas al cuestionario del folio (la última respuesta a una
   * pregunta gana), recalcula la canalización y la manda al CAD. La prioridad
   * nunca baja por una respuesta nueva.
   */
  responderCuestionario(ciudadano: Ciudadano, folio: string, datos: ResponderCuestionario) {
    return this.delCiudadanoBloqueado(ciudadano, folio, async (r) => {
      if (ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_finalizado' });
      const protocolo = this.protocolos.vigente();
      const { validas, desconocidas } = resolverEntradas(protocolo, r.incidenteId, datos.entradas, datos.via);
      if (!validas.length) throw new BadRequestException({ codigo: 'respuestas_invalidas', preguntas: desconocidas });
      r.cuestionario.entradas.push(...validas);
      const respuestas = respuestasDe(r.cuestionario.entradas);
      Object.assign(r.respuestas, respuestas);
      const incidente = incidentePorId(r.incidenteId) as IncidenteCatalogo;
      const nueva = canalizar(protocolo, incidente, respuestas, { asistenciaDirecta: r.asistenciaDirecta });
      const prioridad = ORDEN[nueva.prioridad] >= ORDEN[r.prioridad] ? nueva.prioridad : r.prioridad;
      r.canalizacion = { ...nueva, prioridad, corporaciones: [r.corporacionSugerida, ...nueva.corporaciones.filter((c) => c !== r.corporacionSugerida)] };
      r.prioridad = prioridad;
      // El código CNIE se afina con las respuestas, salvo que ya lo haya fijado un operador o el ciudadano en el catálogo.
      if (!r.cnie || r.cnie.origen === 'catalogo' || r.cnie.origen === 'respuestas') {
        const cnie = clasificarCnie(r.incidenteId, r.respuestas);
        if (JSON.stringify(cnie) !== JSON.stringify(r.cnie ?? null)) {
          await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'cnie_afinado', folio, detalle: { de: codigoDe(r.cnie), a: codigoDe(cnie) } });
          r.cnie = cnie;
          r.codigoCnie = cnie?.incidente?.codigo ?? null;
        }
      }
      await this.despachador.enviarCuestionario(r);
      await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'cuestionario_respondido', folio, detalle: { preguntas: validas.map((v) => v.preguntaId), via: datos.via } });
      await this.tocar(r);
      return r;
    });
  }

  /**
   * Calificación de la atención y, si no llegó nadie o fue mala, queja.
   * Solo cuando el reporte terminó y una sola vez por folio.
   */
  opinar(ciudadano: Ciudadano, folio: string, opinion: Opinion) {
    return this.delCiudadanoBloqueado(ciudadano, folio, async (r) => {
      if (!ESTADOS_FINALES.includes(r.estado)) throw new ConflictException({ codigo: 'reporte_en_curso', mensaje: 'Podrás calificar cuando el reporte termine.' });
      if (r.opinion) throw new ConflictException({ codigo: 'opinion_ya_registrada' });
      const queja = esQueja(opinion);
      r.opinion = { ...opinion, queja, en: new Date().toISOString() };
      await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: queja ? 'queja_registrada' : 'atencion_calificada', folio, detalle: { calificacion: opinion.calificacion, llegoUnidad: opinion.llegoUnidad } });
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

  /**
   * Corrección del código CNIE por un operador (consola) o por el CAD. Valida
   * contra el CNIE V 3.0 y deja en la bitácora el código anterior, el nuevo y el motivo.
   * Quien llama guarda el reporte.
   */
  async corregirCnie(r: Reporte, datos: { codigoCnie: string; codigoCnieSecundario?: string | null; motivo?: string; operador?: string }, actor: string) {
    validarCnieOFallar(datos.codigoCnie, 'codigoCnie');
    if (datos.codigoCnieSecundario) validarCnieOFallar(datos.codigoCnieSecundario, 'codigoCnieSecundario');
    const malUso = esMalUso(datos.codigoCnie);
    exigirMotivoMalUso(datos);
    const antes = r.cnie ?? null;
    const nuevo = clasificacionDe(datos.codigoCnie, 'operador', datos.codigoCnieSecundario ?? antes?.secundario?.codigo ?? null);
    if (datos.codigoCnieSecundario === null) nuevo.secundario = null;
    r.cnie = nuevo;
    r.codigoCnie = nuevo.incidente!.codigo;
    const tipoDe = antes?.tipo.codigo ?? null;
    (r.correccionesCnie ??= []).push({ en: new Date().toISOString(), actor, de: codigoDe(antes), a: nuevo.incidente!.codigo, secundario: nuevo.secundario?.codigo ?? null, motivo: datos.motivo?.trim() || null, tipoDe, tipoA: nuevo.tipo.codigo, ...(malUso && { malUso: true }) });
    if (malUso) {
      // Recatalogación a Mal Uso: queda en el historial sin cambiar el estado, con el tipo original, quién y por qué.
      const original = tipoDe ? `${tipoDe} ${tipoCnie(tipoDe)?.nombre ?? ''} (${codigoDe(antes)})` : 'sin clasificar';
      r.historial.push({ estado: r.estado, en: new Date().toISOString(), nota: `Recatalogado a Mal Uso del servicio (Improcedentes) por ${datos.operador ?? actor}: tipo ${original} → ${nuevo.tipo.codigo} ${nuevo.tipo.nombre} (${nuevo.incidente!.codigo}). Motivo: ${datos.motivo!.trim()}` });
    }
    await this.almacen.auditar({
      actor,
      accion: 'cnie_corregido',
      folio: r.folio,
      detalle: { de: codigoDe(antes), a: nuevo.incidente!.codigo, secundarioDe: antes?.secundario?.codigo ?? null, secundarioA: nuevo.secundario?.codigo ?? null, motivo: datos.motivo ?? null, tipoDe, tipoA: nuevo.tipo.codigo, malUso },
    });
  }

  /** Guarda el reporte y avisa en tiempo real al ciudadano y a la consola. */
  async tocar(r: Reporte, cadAnterior?: string) {
    r.actualizadoEn = new Date().toISOString();
    await this.almacen.guardarReporte(r);
    this.bus.reporteCambio(r, cadAnterior !== r.cadId ? cadAnterior : undefined);
  }
}
