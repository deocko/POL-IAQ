import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { ESTADOS_FINALES, PERFIL_VACIO, type Perfil } from '@pol-iaq/shared';
import { Almacen } from './almacen';
import { migrar } from './migraciones';
import type { Auditoria, Ciudadano, Envio, Evidencia, Mensaje, Otp, Reporte } from './modelos';

const iso = (d: Date | string | null | undefined) => (d == null ? undefined : new Date(d).toISOString());
const num = (x: string | number | null | undefined) => (x == null ? undefined : Number(x));
/** Punto PostGIS a partir de lng/lat (SRID 4326). */
const PUNTO = (lng: string, lat: string) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

const SELECT_CIUDADANO = `
  SELECT c.id, c.telefono, c.nombre, c.confiabilidad, c.suspendido,
         a.aviso_privacidad_version, a.terminos_version, a.aceptado_en
    FROM ciudadano c
    LEFT JOIN LATERAL (
      SELECT aviso_privacidad_version, terminos_version, aceptado_en
        FROM aceptacion_legal WHERE ciudadano_id = c.id
       ORDER BY aceptado_en DESC, id DESC LIMIT 1
    ) a ON true`;

const SELECT_REPORTE = `
  SELECT folio, ciudadano_id, incidente_id, codigo_cnie, prioridad, corporacion_sugerida,
         ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lng, precision_m, referencia,
         municipio_clave, cad_id, folio_cad, descripcion, respuestas, asistencia_directa, escenario_id, cuestionario, canalizacion,
         ocultar_identidad_a_unidad, estado, secuencia_salida, secuencia_entrada, creado_en, actualizado_en
    FROM reporte`;

/**
 * Almacén en PostgreSQL + PostGIS. Las ubicaciones se guardan como
 * `geography(Point, 4326)`. Dentro de `conReporte` todas las consultas usan
 * la misma conexión y transacción (AsyncLocalStorage).
 */
export class AlmacenPostgres extends Almacen {
  /**
   * Transacción en curso. `activa` se apaga al terminar: las tareas que se
   * lanzaron dentro (reintentos, temporizadores) heredan el contexto, pero ya
   * no deben usar esa conexión.
   */
  private readonly transaccion = new AsyncLocalStorage<{ cliente: PoolClient; activa: boolean }>();

  constructor(readonly pool: Pool) {
    super();
  }

  static async conectar(url: string, opciones: { migrar?: boolean } = {}) {
    const pool = new Pool({ connectionString: url, max: 10 });
    pool.on('error', (err) => console.error('PostgreSQL:', err.message));
    if (opciones.migrar !== false) await migrar(pool);
    return new AlmacenPostgres(pool);
  }

  async cerrar() {
    await this.pool.end();
  }

  aparte<T>(fn: () => T): T {
    return this.transaccion.exit(fn);
  }

  private async q<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    const t = this.transaccion.getStore();
    return (t?.activa ? t.cliente : this.pool).query<R>(sql, params);
  }

  /** Corre `fn` en una transacción; si ya hay una abierta, la reutiliza. */
  private async enTransaccion<T>(fn: () => Promise<T>): Promise<T> {
    if (this.transaccion.getStore()?.activa) return fn();
    const cliente = await this.pool.connect();
    const t = { cliente, activa: true };
    try {
      await cliente.query('BEGIN');
      const res = await this.transaccion.run(t, fn);
      t.activa = false;
      await cliente.query('COMMIT');
      return res;
    } catch (err) {
      t.activa = false;
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      cliente.release();
    }
  }

  // ── Ciudadanos ────────────────────────────────────────────────────────────

  private aCiudadano(f: Record<string, any>): Ciudadano {
    return {
      id: f.id,
      telefono: f.telefono,
      nombre: f.nombre,
      confiabilidad: Number(f.confiabilidad),
      suspendido: f.suspendido,
      avisoPrivacidadVersion: f.aviso_privacidad_version ?? '',
      terminosVersion: f.terminos_version ?? '',
      aceptadoEn: iso(f.aceptado_en) ?? '',
    };
  }

  async ciudadanoPorTelefono(telefono: string) {
    const { rows } = await this.q(`${SELECT_CIUDADANO} WHERE c.telefono = $1`, [telefono]);
    return rows[0] && this.aCiudadano(rows[0]);
  }

  async ciudadano(id: string) {
    const { rows } = await this.q(`${SELECT_CIUDADANO} WHERE c.id = $1`, [id]);
    return rows[0] && this.aCiudadano(rows[0]);
  }

  async guardarCiudadano(c: Ciudadano) {
    await this.enTransaccion(async () => {
      await this.q(
        `INSERT INTO ciudadano (id, telefono, nombre, confiabilidad, suspendido) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET telefono = EXCLUDED.telefono, nombre = EXCLUDED.nombre,
           confiabilidad = EXCLUDED.confiabilidad, suspendido = EXCLUDED.suspendido`,
        [c.id, c.telefono, c.nombre, c.confiabilidad, c.suspendido],
      );
      if (c.aceptadoEn) {
        await this.q(
          `INSERT INTO aceptacion_legal (ciudadano_id, aviso_privacidad_version, terminos_version, aceptado_en)
           SELECT $1, $2, $3, $4
            WHERE NOT EXISTS (SELECT 1 FROM aceptacion_legal WHERE ciudadano_id = $1 AND aceptado_en = $4)`,
          [c.id, c.avisoPrivacidadVersion, c.terminosVersion, c.aceptadoEn],
        );
      }
    });
  }

  // ── Perfil ────────────────────────────────────────────────────────────────

  async perfil(ciudadanoId: string): Promise<Perfil> {
    const { rows } = await this.q('SELECT lugares, escenarios FROM perfil_ciudadano WHERE ciudadano_id = $1', [ciudadanoId]);
    return rows[0] ? { lugares: rows[0].lugares, escenarios: rows[0].escenarios } : structuredClone(PERFIL_VACIO);
  }

  async guardarPerfil(ciudadanoId: string, perfil: Perfil) {
    await this.q(
      `INSERT INTO perfil_ciudadano (ciudadano_id, lugares, escenarios, actualizado_en) VALUES ($1, $2, $3, now())
       ON CONFLICT (ciudadano_id) DO UPDATE SET lugares = EXCLUDED.lugares, escenarios = EXCLUDED.escenarios, actualizado_en = now()`,
      [ciudadanoId, JSON.stringify(perfil.lugares), JSON.stringify(perfil.escenarios)],
    );
  }

  // ── Folios y reportes ─────────────────────────────────────────────────────

  async siguienteConsecutivo(claveMunicipio: string, anio: number) {
    const { rows } = await this.q<{ ultimo: number }>(
      `INSERT INTO folio_consecutivo (clave_municipio, anio, ultimo) VALUES ($1, $2, 1)
       ON CONFLICT (clave_municipio, anio) DO UPDATE SET ultimo = folio_consecutivo.ultimo + 1
       RETURNING ultimo`,
      [claveMunicipio, anio],
    );
    return rows[0].ultimo;
  }

  private async cargarReportes(where: string, params: unknown[]): Promise<Reporte[]> {
    const { rows } = await this.q(`${SELECT_REPORTE} ${where}`, params);
    if (!rows.length) return [];
    const folios = rows.map((r) => r.folio as string);
    // En secuencia: dentro de una transacción todas comparten la misma conexión.
    const historial = await this.q('SELECT folio, estado, nota, en FROM reporte_estado WHERE folio = ANY($1) ORDER BY id', [folios]);
    const mensajes = await this.q('SELECT id, folio, autor, nombre_autor, texto, en FROM mensaje WHERE folio = ANY($1) ORDER BY en, id', [folios]);
    const evidencias = await this.q(
      `SELECT id, folio, tipo, mime_type, bytes, sha256_declarado, sha256_servidor, estado, capturado_en, recibido_en,
              ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lng
         FROM evidencia WHERE folio = ANY($1) ORDER BY capturado_en, id`,
      [folios],
    );
    const unidades = await this.q(
      `SELECT folio, unidad_id, corporacion, etiqueta, eta_minutos, rumbo, actualizado_en,
              ST_Y(posicion::geometry) AS lat, ST_X(posicion::geometry) AS lng
         FROM unidad_asignada WHERE folio = ANY($1) AND activa`,
      [folios],
    );
    const de = <T extends { folio: string }>(lista: T[], folio: string) => lista.filter((x) => x.folio === folio);

    return rows.map((f): Reporte => {
      const u = unidades.rows.find((x) => x.folio === f.folio);
      return {
        folio: f.folio,
        ciudadanoId: f.ciudadano_id,
        incidenteId: f.incidente_id,
        codigoCnie: f.codigo_cnie,
        prioridad: f.prioridad,
        corporacionSugerida: f.corporacion_sugerida,
        ubicacion: {
          lat: Number(f.lat),
          lng: Number(f.lng),
          ...(f.precision_m != null && { precisionMetros: Number(f.precision_m) }),
          ...(f.referencia != null && { referencia: f.referencia }),
        },
        municipioClave: f.municipio_clave,
        cadId: f.cad_id,
        folioCad: f.folio_cad ?? undefined,
        descripcion: f.descripcion ?? undefined,
        respuestas: f.respuestas,
        asistenciaDirecta: f.asistencia_directa,
        escenarioId: f.escenario_id ?? undefined,
        cuestionario: f.cuestionario ?? { protocoloVersion: 'sin-protocolo', protocoloEstado: 'provisional', entradas: [] },
        canalizacion: f.canalizacion ?? { prioridad: f.prioridad, corporaciones: [f.corporacion_sugerida], alertas: [] },
        ocultarIdentidadAUnidad: f.ocultar_identidad_a_unidad,
        estado: f.estado,
        unidad: u && {
          unidadId: u.unidad_id,
          corporacion: u.corporacion,
          etiqueta: u.etiqueta,
          etaMinutos: num(u.eta_minutos),
          lat: num(u.lat),
          lng: num(u.lng),
          rumbo: num(u.rumbo),
          actualizadoEn: iso(u.actualizado_en),
        },
        evidencias: de(evidencias.rows as any[], f.folio).map(
          (e): Evidencia => ({
            id: e.id,
            tipo: e.tipo,
            mimeType: e.mime_type,
            bytes: Number(e.bytes),
            sha256Declarado: e.sha256_declarado,
            sha256Servidor: e.sha256_servidor ?? undefined,
            estado: e.estado,
            capturadoEn: iso(e.capturado_en)!,
            recibidoEn: iso(e.recibido_en),
            ubicacion: e.lat == null ? undefined : { lat: Number(e.lat), lng: Number(e.lng) },
          }),
        ),
        mensajes: de(mensajes.rows as any[], f.folio).map(
          (m): Mensaje => ({ id: m.id, autor: m.autor, ...(m.nombre_autor != null && { nombreAutor: m.nombre_autor }), texto: m.texto, en: iso(m.en)! }),
        ),
        historial: de(historial.rows as any[], f.folio).map((h) => ({ estado: h.estado, en: iso(h.en)!, ...(h.nota != null && { nota: h.nota }) })),
        creadoEn: iso(f.creado_en)!,
        actualizadoEn: iso(f.actualizado_en)!,
        secuenciaSalida: f.secuencia_salida,
        secuenciaEntrada: f.secuencia_entrada,
      };
    });
  }

  async reporte(folio: string) {
    return (await this.cargarReportes('WHERE folio = $1', [folio]))[0];
  }

  async reportesDe(ciudadanoId: string) {
    return this.cargarReportes('WHERE ciudadano_id = $1 ORDER BY creado_en DESC LIMIT 100', [ciudadanoId]);
  }

  async reportesPorCad(cadIds: string[], soloActivos: boolean) {
    const todos = !cadIds.length || cadIds.includes('*');
    return this.cargarReportes(
      `WHERE ($1::boolean OR cad_id = ANY($2)) AND (NOT $3::boolean OR estado <> ALL($4)) ORDER BY creado_en DESC LIMIT 200`,
      [todos, cadIds, soloActivos, [...ESTADOS_FINALES]],
    );
  }

  async contarReportesDesde(ciudadanoId: string, desdeIso: string) {
    const { rows } = await this.q<{ n: string }>('SELECT count(*) AS n FROM reporte WHERE ciudadano_id = $1 AND creado_en >= $2', [ciudadanoId, desdeIso]);
    return Number(rows[0].n);
  }

  async guardarReporte(r: Reporte) {
    await this.enTransaccion(async () => {
      await this.q(
        `INSERT INTO reporte (folio, ciudadano_id, incidente_id, codigo_cnie, prioridad, corporacion_sugerida, ubicacion,
            precision_m, referencia, municipio_clave, cad_id, folio_cad, descripcion, respuestas, asistencia_directa,
            ocultar_identidad_a_unidad, estado, secuencia_salida, secuencia_entrada, creado_en, actualizado_en,
            escenario_id, cuestionario, canalizacion)
         VALUES ($1, $2, $3, $4, $5, $6, ${PUNTO('$7', '$8')}, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
         ON CONFLICT (folio) DO UPDATE SET
            respuestas = EXCLUDED.respuestas, cuestionario = EXCLUDED.cuestionario, canalizacion = EXCLUDED.canalizacion,
            prioridad = EXCLUDED.prioridad, cad_id = EXCLUDED.cad_id, folio_cad = EXCLUDED.folio_cad,
            estado = EXCLUDED.estado, secuencia_salida = EXCLUDED.secuencia_salida,
            secuencia_entrada = EXCLUDED.secuencia_entrada, actualizado_en = EXCLUDED.actualizado_en`,
        [
          r.folio, r.ciudadanoId, r.incidenteId, r.codigoCnie, r.prioridad, r.corporacionSugerida, r.ubicacion.lng, r.ubicacion.lat,
          r.ubicacion.precisionMetros ?? null, r.ubicacion.referencia ?? null, r.municipioClave, r.cadId, r.folioCad ?? null,
          r.descripcion ?? null, JSON.stringify(r.respuestas), r.asistenciaDirecta, r.ocultarIdentidadAUnidad, r.estado,
          r.secuenciaSalida, r.secuenciaEntrada, r.creadoEn, r.actualizadoEn,
          r.escenarioId ?? null, JSON.stringify(r.cuestionario), JSON.stringify(r.canalizacion),
        ],
      );

      // El historial solo crece: se insertan las entradas nuevas.
      const { rows } = await this.q<{ n: string }>('SELECT count(*) AS n FROM reporte_estado WHERE folio = $1', [r.folio]);
      for (const h of r.historial.slice(Number(rows[0].n))) {
        await this.q('INSERT INTO reporte_estado (folio, estado, nota, en) VALUES ($1, $2, $3, $4)', [r.folio, h.estado, h.nota ?? null, h.en]);
      }

      for (const m of r.mensajes) {
        await this.q(
          'INSERT INTO mensaje (id, folio, autor, nombre_autor, texto, en) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING',
          [m.id, r.folio, m.autor, m.nombreAutor ?? null, m.texto, m.en],
        );
      }

      for (const e of r.evidencias) {
        await this.q(
          `INSERT INTO evidencia (id, folio, tipo, mime_type, bytes, sha256_declarado, sha256_servidor, estado, capturado_en, recibido_en, ubicacion)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $11::float8 IS NULL THEN NULL ELSE ${PUNTO('$11', '$12')} END)
           ON CONFLICT (id) DO UPDATE SET sha256_servidor = EXCLUDED.sha256_servidor, estado = EXCLUDED.estado, recibido_en = EXCLUDED.recibido_en`,
          [e.id, r.folio, e.tipo, e.mimeType, e.bytes, e.sha256Declarado, e.sha256Servidor ?? null, e.estado, e.capturadoEn, e.recibidoEn ?? null, e.ubicacion?.lng ?? null, e.ubicacion?.lat ?? null],
        );
      }

      const u = r.unidad;
      await this.q('UPDATE unidad_asignada SET activa = false WHERE folio = $1 AND activa AND unidad_id IS DISTINCT FROM $2', [r.folio, u?.unidadId ?? null]);
      if (u) {
        await this.q(
          `INSERT INTO unidad_asignada (folio, unidad_id, corporacion, etiqueta, eta_minutos, posicion, rumbo, actualizado_en, activa)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ${PUNTO('$6', '$7')} END, $8, $9, true)
           ON CONFLICT (folio, unidad_id) DO UPDATE SET corporacion = EXCLUDED.corporacion, etiqueta = EXCLUDED.etiqueta,
             eta_minutos = EXCLUDED.eta_minutos, posicion = EXCLUDED.posicion, rumbo = EXCLUDED.rumbo,
             actualizado_en = EXCLUDED.actualizado_en, activa = true`,
          [r.folio, u.unidadId, u.corporacion, u.etiqueta, u.etaMinutos ?? null, u.lng ?? null, u.lat ?? null, u.rumbo ?? null, u.actualizadoEn ?? null],
        );
      }
    });
  }

  async evidencia(evidenciaId: string) {
    const { rows } = await this.q<{ folio: string }>('SELECT folio FROM evidencia WHERE id = $1', [evidenciaId]);
    if (!rows[0]) return undefined;
    const r = await this.reporte(rows[0].folio);
    const evidencia = r?.evidencias.find((e) => e.id === evidenciaId);
    return evidencia && { folio: rows[0].folio, evidencia };
  }

  async conReporte<T>(folio: string, fn: () => Promise<T>): Promise<T> {
    return this.enTransaccion(async () => {
      await this.q('SELECT 1 FROM reporte WHERE folio = $1 FOR UPDATE', [folio]);
      return fn();
    });
  }

  async marcarEventoProcesado(eventoId: string, cadId: string, folio: string) {
    const { rowCount } = await this.q('INSERT INTO evento_recibido (evento_id, cad_id, folio) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [eventoId, cadId, folio]);
    return rowCount === 1;
  }

  // ── Evidencia ─────────────────────────────────────────────────────────────

  async guardarContenido(evidenciaId: string, datos: Buffer) {
    await this.q('INSERT INTO evidencia_contenido (evidencia_id, datos) VALUES ($1, $2) ON CONFLICT DO NOTHING', [evidenciaId, datos]);
  }

  async contenido(evidenciaId: string) {
    const { rows } = await this.q<{ datos: Buffer }>('SELECT datos FROM evidencia_contenido WHERE evidencia_id = $1', [evidenciaId]);
    return rows[0]?.datos;
  }

  // ── Auditoría ─────────────────────────────────────────────────────────────

  async auditar(a: Omit<Auditoria, 'en'>) {
    await this.q('INSERT INTO auditoria (actor, accion, folio, detalle) VALUES ($1, $2, $3, $4)', [a.actor, a.accion, a.folio ?? null, a.detalle ? JSON.stringify(a.detalle) : null]);
  }

  async auditoria(folio?: string) {
    const { rows } = await this.q(
      `SELECT en, actor, accion, folio, detalle FROM auditoria ${folio ? 'WHERE folio = $1' : ''} ORDER BY id`,
      folio ? [folio] : [],
    );
    return rows.map((f): Auditoria => ({ en: iso(f.en)!, actor: f.actor, accion: f.accion, folio: f.folio ?? undefined, detalle: f.detalle ?? undefined }));
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  async registrarOtp(o: Omit<Otp, 'id' | 'intentos' | 'usado' | 'creadoEn'>) {
    await this.q('INSERT INTO otp (telefono, codigo_hash, expira_en) VALUES ($1, $2, $3)', [o.telefono, o.codigoHash, o.expiraEn]);
  }

  async ultimoOtp(telefono: string) {
    const { rows } = await this.q('SELECT * FROM otp WHERE telefono = $1 ORDER BY creado_en DESC LIMIT 1', [telefono]);
    const f = rows[0];
    return f && { id: f.id, telefono: f.telefono, codigoHash: f.codigo_hash, expiraEn: iso(f.expira_en)!, intentos: f.intentos, usado: f.usado, creadoEn: iso(f.creado_en)! };
  }

  async contarOtpsDesde(telefono: string, desdeIso: string) {
    const { rows } = await this.q<{ n: string }>('SELECT count(*) AS n FROM otp WHERE telefono = $1 AND creado_en >= $2', [telefono, desdeIso]);
    return Number(rows[0].n);
  }

  async actualizarOtp(id: string, c: Pick<Otp, 'intentos' | 'usado'>) {
    await this.q('UPDATE otp SET intentos = $2, usado = $3 WHERE id = $1', [id, c.intentos, c.usado]);
  }

  // ── Bandeja de salida ─────────────────────────────────────────────────────

  async guardarEnvio(e: Envio) {
    await this.q(
      `INSERT INTO bandeja_salida (evento_id, cad_id, folio, tipo, cuerpo, intentos, estado) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (evento_id) DO UPDATE SET intentos = EXCLUDED.intentos, estado = EXCLUDED.estado`,
      [e.evento.eventoId, e.cadId, e.evento.folio, e.evento.tipo, JSON.stringify(e.evento), e.intentos, e.estado],
    );
  }

  async enviosPendientes() {
    const { rows } = await this.q("SELECT cad_id, cuerpo, intentos, estado FROM bandeja_salida WHERE estado = 'pendiente' ORDER BY creado_en LIMIT 500");
    return rows.map((f): Envio => ({ cadId: f.cad_id, evento: f.cuerpo, intentos: f.intentos, estado: f.estado }));
  }
}
