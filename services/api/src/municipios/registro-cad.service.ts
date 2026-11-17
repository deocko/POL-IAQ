import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import {
  AltaCadSchema, CAD_ESTATAL_ID, CAD_IDS, CASOS_PRUEBA_CAD, ESTADOS_FINALES, casosPendientes, enrutarPorUbicacion, ipPermitida, municipioPorCad, nombreDeCad,
  normalizarHuella, tipoUnidadDe, type AltaCad, type CasoPruebaCad, type Enrutamiento, type Municipio, type TipoUnidad,
} from '@pol-iaq/shared';
import { Almacen } from '../almacen/almacen';
import type { DisponibilidadCad, RegistroCad, UnidadRegistrada } from '../almacen/modelos';
import { CONFIG, type CadConfig, type Config, type UnidadConfig } from '../config';

/** Llave AES-256 para los secretos de los CAD, derivada de TOKEN_SECRET. */
const llave = (secretoTokens: string) => Buffer.from(hkdfSync('sha256', secretoTokens, 'pol-iaq', 'registro-cad:secreto:v1', 32));

export function cifrarSecreto(secretoTokens: string, secreto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(secretoTokens), iv);
  const datos = Buffer.concat([c.update(secreto, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${datos.toString('base64')}`;
}

export function descifrarSecreto(secretoTokens: string, guardado: string): string {
  const [v, iv, tag, datos] = guardado.split(':');
  if (v !== 'v1') throw new Error('Formato de secreto desconocido');
  const d = createDecipheriv('aes-256-gcm', llave(secretoTokens), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}

/**
 * Huella SHA-256 del certificado de cliente que reenvía el proxy que termina mTLS:
 * - PEM en URL (`$ssl_client_escaped_cert` de NGINX), o
 * - `X-Forwarded-Client-Cert` de Envoy (`Hash=<sha256 hex>;…`).
 */
export function huellaDeCabecera(valor: string | undefined): string | null {
  if (!valor) return null;
  const hash = /(?:^|[;,])\s*Hash=([0-9a-fA-F]{64})/.exec(valor);
  if (hash) return hash[1].toLowerCase();
  let pem = valor;
  try { pem = decodeURIComponent(valor); } catch { /* ya viene sin codificar */ }
  const b64 = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem)?.[1].replace(/\s+/g, '');
  return b64 ? createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex') : null;
}

export type ResultadoAcceso = { ok: true } | { ok: false; codigo: 'cad_suspendido' | 'ip_no_permitida' | 'certificado_requerido' | 'certificado_invalido' };

/**
 * Registro de los CAD de los 18 municipios y del C5 (alta, pruebas, activación, migración B→A),
 * y sus unidades. Lo que se registra aquí se suma a `config.cads` y `config.unidades`, que siguen
 * siendo la fuente para el despachador, el webhook y la consola (el contrato v1 no cambia).
 */
@Injectable()
export class RegistroCadService implements OnModuleInit {
  /** Lo que venía de las variables de entorno, para poder recalcular. */
  private readonly baseCads: Record<string, CadConfig>;
  private readonly baseUnidades: UnidadConfig[];
  private registros = new Map<string, RegistroCad>();
  private unidades = new Map<string, UnidadRegistrada>();
  private disponibilidad = new Map<string, DisponibilidadCad>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
  ) {
    this.baseCads = structuredClone(config.cads);
    this.baseUnidades = structuredClone(config.unidades);
  }

  async onModuleInit() {
    await this.recargar();
  }

  /** Vuelve a leer el registro y lo aplica sobre la configuración. */
  async recargar() {
    this.registros = new Map((await this.almacen.registrosCad()).map((r) => [r.cadId, r]));
    this.unidades = new Map((await this.almacen.unidadesRegistradas()).map((u) => [u.unidadId, u]));
    this.disponibilidad = new Map((await this.almacen.disponibilidades()).map((d) => [d.cadId, d]));
    const cads: Record<string, CadConfig> = structuredClone(this.baseCads);
    for (const r of this.registros.values()) {
      cads[r.cadId] = {
        ...cads[r.cadId],
        modo: r.modo,
        estado: r.estado,
        ...(r.webhookUrl && { webhookUrl: r.webhookUrl }),
        ...(r.secretoCifrado && { secreto: descifrarSecreto(this.config.secretoTokens, r.secretoCifrado) }),
        ipsPermitidas: r.ipsPermitidas,
        ...(r.certificadoSha256 && { certificadoSha256: normalizarHuella(r.certificadoSha256) }),
        ...(r.poligono && { poligono: r.poligono }),
      };
    }
    // Se reemplaza el contenido (no el objeto): los servicios guardan la referencia a config.
    for (const k of Object.keys(this.config.cads)) delete this.config.cads[k];
    Object.assign(this.config.cads, cads);
    const registradas = [...this.unidades.values()];
    const ids = new Set(registradas.map((u) => u.unidadId));
    const unidades: UnidadConfig[] = [
      ...this.baseUnidades.filter((u) => !ids.has(u.unidadId)),
      ...registradas.filter((u) => u.activa).map((u) => ({ unidadId: u.unidadId, cadId: u.cadId, corporacion: u.corporacion, etiqueta: u.etiqueta, tipo: u.tipo, ...(u.base && { base: u.base }) })),
    ];
    this.config.unidades.splice(0, this.config.unidades.length, ...unidades);
  }

  /**
   * ¿El CAD ya recibe reportes? El C5 siempre. Un piloto, salvo que esté suspendido. Los demás,
   * cuando están dados de alta y activos (o en pruebas, solo fuera de producción).
   */
  conectado(cadId: string): boolean {
    if (cadId === CAD_ESTATAL_ID) return true;
    const cad = this.config.cads[cadId];
    if (cad?.estado === 'suspendido') return false;
    if (municipioPorCad(cadId)?.piloto) return true;
    if (!cad || (!cad.webhookUrl && cad.modo !== 'consola')) return false;
    if (!cad.estado || cad.estado === 'activo') return true;
    return !this.config.produccion;
  }

  /**
   * ¿El municipio puede contestar ahora? null = sí; si no, el motivo (sus reportes nuevos van al CQ CIAS).
   * - Modo B (consola): sin unidades en servicio registradas.
   * - Cualquier modo: marcado «sin operador disponible» desde la consola.
   * En Modo A las unidades las maneja el CAD propio: no se revisan aquí.
   */
  capacidad(cadId: string): string | null {
    if (cadId === CAD_ESTATAL_ID) return null;
    const motivos: string[] = [];
    if (this.config.cads[cadId]?.modo === 'consola' && !this.config.unidades.some((u) => u.cadId === cadId)) motivos.push('sin unidades en servicio');
    if (this.disponibilidad.get(cadId)?.sinOperador) motivos.push('sin operador disponible');
    return motivos.length ? motivos.join(' y ') : null;
  }

  disponibilidadDe(cadId: string): DisponibilidadCad | null {
    return this.disponibilidad.get(cadId) ?? null;
  }

  /** Marca o quita «sin operador disponible» de un CAD municipal (queda en la bitácora). */
  async marcarDisponibilidad(cadId: string, sinOperador: boolean, nota: string | null, quien: string) {
    if (cadId === CAD_ESTATAL_ID || !CAD_IDS.includes(cadId)) throw new BadRequestException({ codigo: 'cad_invalido' });
    const d: DisponibilidadCad = { cadId, sinOperador, nota: nota?.trim() || null, en: new Date().toISOString(), por: quien };
    await this.almacen.guardarDisponibilidad(d);
    await this.almacen.auditar({ actor: quien, accion: sinOperador ? 'cad_sin_operador' : 'cad_con_operador', detalle: { cadId, nota: d.nota } });
    this.disponibilidad.set(cadId, d);
    return d;
  }

  /** Geocerca vigente del municipio (la del alta, si trae una; si no, INEGI 2022). */
  geocerca(m: Municipio) {
    return this.config.cads[m.cadId]?.poligono ?? m.geocerca;
  }

  enrutar(lat: number, lng: number, opciones: { anonimo?: boolean } = {}): Enrutamiento {
    return enrutarPorUbicacion(lat, lng, (id) => this.conectado(id), (m) => this.geocerca(m), { capacidad: (id) => this.capacidad(id), anonimo: opciones.anonimo });
  }

  /** Revisa estado, IP y certificado de cliente de una llamada de un CAD (la firma se revisa aparte). */
  acceso(cadId: string, ip: string | undefined, cabeceraCert: string | undefined): ResultadoAcceso {
    const cad = this.config.cads[cadId];
    if (!cad) return { ok: true };
    if (cad.estado === 'suspendido') return { ok: false, codigo: 'cad_suspendido' };
    if (cad.ipsPermitidas?.length && !ipPermitida(ip ?? '', cad.ipsPermitidas)) return { ok: false, codigo: 'ip_no_permitida' };
    if (cad.certificadoSha256) {
      const huella = huellaDeCabecera(cabeceraCert);
      if (!huella) return this.config.exigirMtls ? { ok: false, codigo: 'certificado_requerido' } : { ok: true };
      if (huella !== normalizarHuella(cad.certificadoSha256)) return { ok: false, codigo: 'certificado_invalido' };
    }
    return { ok: true };
  }

  /** Los 18 municipios y el C5, con su modo, estado y avance de pruebas. Sin secretos. */
  lista() {
    return CAD_IDS.map((cadId) => this.vista(cadId));
  }

  vista(cadId: string) {
    const m = municipioPorCad(cadId);
    const r = this.registros.get(cadId);
    const cad = this.config.cads[cadId];
    const modo = cad?.modo ?? (cad?.webhookUrl ? 'webhook' : null);
    const unidades = this.config.unidades.filter((u) => u.cadId === cadId);
    return {
      cadId,
      nombre: r?.nombre ?? nombreDeCad(cadId),
      clave: m?.clave ?? null,
      claveFolio: m?.claveFolio ?? null,
      municipio: m?.nombre ?? null,
      piloto: m?.piloto ?? false,
      registrado: !!r,
      modo,
      estado: cad?.estado ?? (cad && (cad.webhookUrl || cad.modo === 'consola') ? 'activo' : null),
      conectado: this.conectado(cadId),
      /** Conectado pero sin capacidad (sus reportes nuevos van al CQ CIAS): el motivo; si no, null. */
      sinCapacidad: this.conectado(cadId) ? this.capacidad(cadId) : null,
      sinOperador: !!this.disponibilidad.get(cadId)?.sinOperador,
      webhookUrl: cad?.webhookUrl ?? null,
      tieneSecreto: !!cad?.secreto,
      certificadoSha256: cad?.certificadoSha256 ?? null,
      ipsPermitidas: cad?.ipsPermitidas ?? [],
      poligonoPropio: !!cad?.poligono,
      contactoTecnico: r?.contactoTecnico ?? null,
      casosPrueba: CASOS_PRUEBA_CAD.map((c) => ({ ...c, resultado: r?.casosPrueba[c.id] ?? null })),
      casosPendientes: casosPendientes(r?.casosPrueba),
      unidades: unidades.length,
      migracion: r?.migracion ?? null,
      actualizadoEn: r?.actualizadoEn ?? null,
    };
  }

  /** Alta o cambio de un CAD. Un CAD nuevo queda en `pruebas` (los pilotos y el C5, activos). */
  async guardar(datos: AltaCad, quien: string) {
    const p = AltaCadSchema.safeParse(datos);
    if (!p.success) throw new BadRequestException({ codigo: 'alta_invalida', errores: p.error.issues });
    const d = p.data;
    const previo = this.registros.get(d.cadId);
    if (previo && previo.modo === 'consola' && d.modo === 'webhook' && previo.estado === 'activo') {
      throw new ConflictException({ codigo: 'usar_migracion', mensaje: 'Para pasar un municipio activo de la consola a su CAD usa la migración (conserva folios e historial).' });
    }
    const secretoCifrado = d.secreto ? cifrarSecreto(this.config.secretoTokens, d.secreto) : previo?.secretoCifrado ?? (this.baseCads[d.cadId]?.secreto && cifrarSecreto(this.config.secretoTokens, this.baseCads[d.cadId].secreto!));
    if (d.modo === 'webhook' && !secretoCifrado) throw new BadRequestException({ codigo: 'falta_secreto', mensaje: 'El Modo A (webhook) requiere el secreto HMAC compartido.' });
    const ahora = new Date().toISOString();
    const yaConectado = !!municipioPorCad(d.cadId)?.piloto || d.cadId === CAD_ESTATAL_ID;
    const r: RegistroCad = {
      cadId: d.cadId,
      nombre: d.nombre,
      clave: d.clave,
      modo: d.modo,
      estado: previo?.estado ?? (yaConectado ? 'activo' : 'pruebas'),
      ...(d.poligono && { poligono: d.poligono as [number, number][] }),
      ...(d.modo === 'webhook' && d.webhookUrl && { webhookUrl: d.webhookUrl }),
      ...(secretoCifrado && { secretoCifrado }),
      ...(d.certificadoSha256 && { certificadoSha256: normalizarHuella(d.certificadoSha256) }),
      ipsPermitidas: d.ipsPermitidas,
      contactoTecnico: d.contactoTecnico,
      // Si cambia cómo se conecta (modo o URL), las pruebas se repiten.
      casosPrueba: previo && previo.modo === d.modo && previo.webhookUrl === d.webhookUrl ? previo.casosPrueba : {},
      creadoEn: previo?.creadoEn ?? ahora,
      actualizadoEn: ahora,
      ...(previo?.migracion && { migracion: previo.migracion }),
    };
    await this.almacen.guardarRegistroCad(r);
    await this.almacen.auditar({ actor: quien, accion: previo ? 'cad_modificado' : 'cad_alta', detalle: { cadId: r.cadId, clave: r.clave, modo: r.modo, estado: r.estado, secretoCambiado: !!d.secreto } });
    await this.recargar();
    return this.vista(r.cadId);
  }

  private registro(cadId: string) {
    const r = this.registros.get(cadId);
    if (!r) throw new NotFoundException({ codigo: 'cad_sin_alta', mensaje: `${cadId} no tiene alta registrada.` });
    return r;
  }

  /** Resultado de un caso de prueba (lo registra la suite de certificación o el equipo técnico). */
  async registrarCaso(cadId: string, caso: CasoPruebaCad, ok: boolean, detalle: string | undefined, quien: string) {
    if (!CASOS_PRUEBA_CAD.some((c) => c.id === caso)) throw new BadRequestException({ codigo: 'caso_desconocido' });
    const r = this.registro(cadId);
    r.casosPrueba = { ...r.casosPrueba, [caso]: { ok, en: new Date().toISOString(), ...(detalle && { detalle }) } };
    r.actualizadoEn = new Date().toISOString();
    await this.almacen.guardarRegistroCad(r);
    await this.almacen.auditar({ actor: quien, accion: 'cad_caso_prueba', detalle: { cadId, caso, ok } });
    await this.recargar();
    return this.vista(cadId);
  }

  /**
   * Pasa el CAD a producción. Modo A: los 8 casos aprobados (y en producción, IPs y certificado).
   * Modo B: al menos una unidad activa registrada.
   */
  async cambiarEstado(cadId: string, estado: 'activo' | 'suspendido' | 'pruebas', quien: string, motivo?: string) {
    const r = this.registro(cadId);
    if (estado === 'activo') {
      if (r.modo === 'webhook') {
        const faltan = casosPendientes(r.casosPrueba);
        if (faltan.length) throw new ConflictException({ codigo: 'casos_pendientes', faltan, mensaje: 'Faltan casos de prueba aprobados para pasar a producción.' });
        if (this.config.produccion && (!r.certificadoSha256 || !r.ipsPermitidas.length)) throw new ConflictException({ codigo: 'falta_mtls_o_ips', mensaje: 'En producción el CAD necesita certificado de cliente (mTLS) y lista de IPs.' });
      } else if (!this.config.unidades.some((u) => u.cadId === cadId)) {
        throw new ConflictException({ codigo: 'sin_unidades', mensaje: 'Registra al menos una unidad antes de activar el despacho desde la consola.' });
      }
    }
    r.estado = estado;
    r.actualizadoEn = new Date().toISOString();
    await this.almacen.guardarRegistroCad(r);
    await this.almacen.auditar({ actor: quien, accion: `cad_${estado}`, detalle: { cadId, motivo } });
    await this.recargar();
    return this.vista(cadId);
  }

  /**
   * Migración de Modo B (consola) a Modo A (CAD propio) sin perder nada: los folios, su CNIE y su
   * historial no se tocan. Solo cambia por dónde llegan los eventos. Devuelve los folios activos,
   * que quien llama reenvía al CAD como `incidente.creado` (con `estadoActual`).
   */
  async migrarAModoA(cadId: string, datos: { webhookUrl: string; secreto?: string }, quien: string) {
    const r = this.registro(cadId);
    if (r.modo !== 'consola') throw new ConflictException({ codigo: 'no_es_consola', mensaje: 'Este CAD ya está en Modo A.' });
    const faltan = casosPendientes(r.casosPrueba);
    if (faltan.length) throw new ConflictException({ codigo: 'casos_pendientes', faltan, mensaje: 'Antes de migrar, el CAD debe aprobar los casos de prueba en el ambiente de pruebas.' });
    const secretoCifrado = datos.secreto ? cifrarSecreto(this.config.secretoTokens, datos.secreto) : r.secretoCifrado;
    if (!secretoCifrado) throw new BadRequestException({ codigo: 'falta_secreto' });
    const activos = (await this.almacen.reportesPorCad([cadId], true)).filter((x) => !ESTADOS_FINALES.includes(x.estado));
    r.modo = 'webhook';
    r.webhookUrl = datos.webhookUrl;
    r.secretoCifrado = secretoCifrado;
    r.migracion = { en: new Date().toISOString(), por: quien, foliosReenviados: activos.length };
    r.actualizadoEn = r.migracion.en;
    await this.almacen.guardarRegistroCad(r);
    await this.almacen.auditar({ actor: quien, accion: 'cad_migrado_modo_a', detalle: { cadId, foliosActivos: activos.map((x) => x.folio) } });
    await this.recargar();
    return activos.map((x) => x.folio);
  }

  /** Alta o baja de una unidad de un CAD. */
  async guardarUnidad(datos: { unidadId: string; cadId: string; tipo: TipoUnidad; corporacion: string; etiqueta: string; activa: boolean; base?: { lat: number; lng: number } }, quien: string) {
    if (!CAD_IDS.includes(datos.cadId)) throw new BadRequestException({ codigo: 'cad_desconocido' });
    const deOtro = this.config.unidades.find((u) => u.unidadId === datos.unidadId && u.cadId !== datos.cadId) ?? [...this.unidades.values()].find((u) => u.unidadId === datos.unidadId && u.cadId !== datos.cadId);
    if (deOtro) throw new ConflictException({ codigo: 'unidad_de_otro_cad', mensaje: `La clave ${datos.unidadId} ya es de otro CAD.` });
    const previa = this.unidades.get(datos.unidadId);
    const u: UnidadRegistrada = { ...datos, registradaEn: previa?.registradaEn ?? new Date().toISOString(), registradaPor: previa?.registradaPor ?? quien };
    await this.almacen.guardarUnidad(u);
    await this.almacen.auditar({ actor: quien, accion: previa ? 'unidad_modificada' : 'unidad_alta', detalle: { unidadId: u.unidadId, cadId: u.cadId, tipo: u.tipo, corporacion: u.corporacion, activa: u.activa } });
    await this.recargar();
    return u;
  }

  /** Unidades del CAD (de configuración y registradas), con su tipo y si están activas. */
  unidadesDe(cadIds: string[]) {
    const todos = cadIds.includes('*');
    const registradas = [...this.unidades.values()];
    const ids = new Set(registradas.map((u) => u.unidadId));
    return [
      ...this.baseUnidades.filter((u) => !ids.has(u.unidadId)).map((u) => ({ ...u, tipo: tipoUnidadDe(u), activa: true, origen: 'configuracion' as const })),
      ...registradas.map((u) => ({ ...u, origen: 'registro' as const })),
    ].filter((u) => todos || cadIds.includes(u.cadId));
  }
}

