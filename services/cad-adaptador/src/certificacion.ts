/**
 * Suite de certificación de un CAD (Modo A) en el AMBIENTE DE PRUEBAS de POL-IAQ.
 *
 * Levanta reportes de DEMOSTRACIÓN dentro de la geocerca del municipio, observa lo que hace el CAD
 * (a través del adaptador o de su propia integración) y revisa los 8 casos obligatorios antes de
 * producción. Con `registrar`, deja el resultado de cada caso en el alta del CAD
 * (POST /v1/admin/cads/:cadId/casos/:caso), que es lo que exige la activación.
 *
 * El CAD de prueba debe entender las marcas `[prueba:…]` de la descripción (el simulador las
 * entiende); con un CAD real, el equipo técnico del municipio hace a mano lo que pide cada marca.
 */
import { AVISO_PRIVACIDAD_VERSION, CASOS_PRUEBA_CAD, INCIDENTES_CNIE, TERMINOS_VERSION, puntoInterior, validarCodigoCnie, type CasoPruebaCad, type ResultadoCaso } from '@pol-iaq/shared';

export interface OpcionesCertificacion {
  polIaqUrl: string;
  cadId: string;
  supervisor: { usuario: string; clave: string };
  /** Código OTP del ambiente de pruebas (OTP_DEV del API). */
  otp: string;
  /** CAD al que el CAD en prueba transfiere un folio (otro municipio conectado, o el C5). */
  destinoTransferencia: string;
  /** Tiempo límite del acuse (CAD_ACK_TIMEOUT_SEC del ambiente). */
  esperaAcuseSeg: number;
  /** Tiempo máximo para cada caso. */
  tiempoMaxSeg: number;
  registrar: boolean;
  log?: (l: string) => void;
}

type Vista = {
  folio: string; cadId: string; folioCad: string | null; estado: string; creadoEn: string;
  unidad: { unidadId: string; lat?: number } | null; historial: { estado: string; en: string }[];
  correccionesCnie: { actor: string; a: string }[]; cnie: { incidente: { codigo: string } | null; subtipo: { codigo: string } } | null;
};

export async function certificar(o: OpcionesCertificacion): Promise<Record<CasoPruebaCad, ResultadoCaso>> {
  const log = o.log ?? ((l: string) => console.log(l));
  const resultados = {} as Record<CasoPruebaCad, ResultadoCaso>;
  const anotar = (caso: CasoPruebaCad, ok: boolean, detalle: string) => {
    resultados[caso] = { ok, en: new Date().toISOString(), detalle };
    log(`${ok ? '✔' : '✘'} ${CASOS_PRUEBA_CAD.find((c) => c.id === caso)!.nombre}: ${detalle}`);
  };

  async function api<T>(ruta: string, init: { metodo?: string; token?: string; cuerpo?: unknown } = {}): Promise<{ status: number; body: T }> {
    const r = await fetch(`${o.polIaqUrl}${ruta}`, {
      method: init.metodo ?? (init.cuerpo ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(init.token && { authorization: `Bearer ${init.token}` }) },
      ...(init.cuerpo !== undefined && { body: JSON.stringify(init.cuerpo) }),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
  }
  const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const sup = (await api<{ token: string }>('/v1/operador/sesion', { cuerpo: o.supervisor })).body.token;
  if (!sup) throw new Error('No se pudo entrar como supervisión: revisa usuario y clave.');
  const cad = (await api<{ poligono: [number, number][] | null; estado: string | null; modo: string | null }>(`/v1/admin/cads/${o.cadId}`, { token: sup })).body;
  if (!cad.poligono) throw new Error(`${o.cadId} no tiene polígono (¿es el C5?).`);
  const punto = puntoInterior(cad.poligono);
  if (!punto) throw new Error('No se encontró un punto dentro de la geocerca.');

  // Ciudadano de demostración (número ficticio del ambiente de pruebas).
  const telefono = `+52442${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const ciudadano = (await api<{ token: string }>('/v1/auth/verificar', { cuerpo: { telefono, codigo: o.otp, nombre: 'Prueba de certificación', aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION } })).body.token;
  if (!ciudadano) throw new Error('No se pudo registrar el ciudadano de prueba: ¿el ambiente acepta el OTP de pruebas?');

  async function reporte(descripcion: string) {
    const r = await api<{ folio: string }>('/v1/reportes', { token: ciudadano, cuerpo: { incidenteId: 'emergencia-medica', ubicacion: punto, descripcion } });
    if (r.status !== 201) throw new Error(`No se pudo crear el reporte de prueba (${r.status})`);
    log(`Reporte de prueba ${r.body.folio}: ${descripcion}`);
    return r.body.folio;
  }
  const vista = async (folio: string) => (await api<Vista>(`/v1/operador/reportes/${folio}`, { token: sup })).body;
  async function esperar(folio: string, cond: (v: Vista) => boolean, seg = o.tiempoMaxSeg): Promise<Vista | null> {
    const fin = Date.now() + seg * 1000;
    while (Date.now() < fin) {
      const v = await vista(folio);
      if (cond(v)) return v;
      await pausa(250);
    }
    return null;
  }
  const paso = (v: Vista | null, e: string) => !!v?.historial.some((h) => h.estado === e);

  // A) Flujo completo: acuse, asignación, GPS (evento y AVL), llegada y cierre.
  const a = await reporte('[prueba:flujo] [prueba:duplicado] Reporte de certificación (demostración)');
  const conAcuse = await esperar(a, (v) => !!v.folioCad || v.cadId !== o.cadId, o.esperaAcuseSeg + 2);
  const tAcuse = conAcuse && (Date.parse(conAcuse.historial.find((h) => h.estado === 'validado')?.en ?? '') - Date.parse(conAcuse.creadoEn)) / 1000;
  anotar('acuse', !!conAcuse?.folioCad && conAcuse.cadId === o.cadId && tAcuse !== null && tAcuse <= o.esperaAcuseSeg,
    conAcuse?.folioCad ? `folio del CAD ${conAcuse.folioCad} en ${tAcuse?.toFixed(1)} s (límite ${o.esperaAcuseSeg} s)` : 'sin acuse a tiempo (el folio se escaló al C5)');
  const asignado = await esperar(a, (v) => !!v.unidad);
  anotar('asignacion', !!asignado?.unidad, asignado?.unidad ? `unidad ${asignado.unidad.unidadId}` : 'sin unidad asignada');
  const enCamino = await esperar(a, (v) => v.unidad?.lat !== undefined && paso(v, 'en_camino'));
  let avlOk = false;
  if (enCamino?.unidad) {
    const fin = Date.now() + o.tiempoMaxSeg * 1000;
    while (!avlOk && Date.now() < fin) {
      const u = (await api<{ unidades: { unidadId: string; posicion: unknown }[] }>('/v1/operador/unidades', { token: sup })).body.unidades;
      avlOk = !!u?.find((x) => x.unidadId === enCamino.unidad!.unidadId)?.posicion;
      if (!avlOk) await pausa(500);
    }
  }
  anotar('gps', !!enCamino && avlOk, !enCamino ? 'no llegó unidad.posicion' : avlOk ? 'unidad.posicion del folio y AVL en lote recibidos' : 'llegó unidad.posicion pero no el AVL en lote (¿la unidad está registrada en el padrón del CAD?)');
  const cerrado = await esperar(a, (v) => v.estado === 'cerrado');
  anotar('cierre', paso(cerrado, 'en_sitio') && paso(cerrado, 'cerrado'), cerrado ? 'en_sitio y cerrado en el historial' : `quedó en ${(await vista(a)).estado}`);

  // B) Duplicado: POL-IAQ reentrega el mismo incidente.creado (mismo eventoId) y el CAD manda su acuse dos veces.
  await api(`/v1/admin/cads/${o.cadId}/reenviar`, { token: sup, cuerpo: { folio: a } });
  await pausa(3000);
  const bitacora = (await api<{ entradas: { actor: string; accion: string }[] }>(`/v1/admin/auditoria?folio=${encodeURIComponent(a)}`, { token: sup })).body.entradas ?? [];
  const acuses = bitacora.filter((x) => x.accion === 'incidente.recibido' && x.actor === `cad:${o.cadId}`).length;
  anotar('duplicado', acuses === 1, `${acuses} acuse(s) aplicados para el folio tras reentregar el alta y repetir el acuse`);

  // C) Reclasificación: el CAD corrige el código CNIE.
  // Un incidente vigente del CNIE V 3.0 de otro subtipo que el del reporte (mismo tipo de reporte que A).
  const cnieA = (await vista(a)).cnie;
  const otro = INCIDENTES_CNIE.find((i) => i.subtipo.codigo !== cnieA?.subtipo.codigo && validarCodigoCnie(i.codigo).ok)!.codigo;
  const b = await reporte(`[prueba:reclasificar=${otro}] Reporte de certificación: reclasificación (demostración)`);
  const reclas = await esperar(b, (v) => v.correccionesCnie.some((c) => c.actor === `cad:${o.cadId}` && c.a === otro));
  anotar('reclasificacion', !!reclas, reclas ? `CNIE corregido a ${otro} y en la bitácora` : `el código no cambió a ${otro}`);

  // D) Transferencia a otro municipio (o al C5).
  const c = await reporte(`[prueba:transferir=${o.destinoTransferencia}] Reporte de certificación: transferencia (demostración)`);
  const transf = await esperar(c, (v) => v.cadId === o.destinoTransferencia && paso(v, 'transferido'));
  anotar('transferencia', !!transf, transf ? `transferido a ${o.destinoTransferencia}` : 'no se transfirió');

  // E) Caída del webhook: el CAD rechaza las 2 primeras entregas y POL-IAQ reintenta.
  const d = await reporte('[prueba:caida=2] Reporte de certificación: caída del webhook (demostración)');
  const conAcuseD = await esperar(d, (v) => !!v.folioCad, Math.max(o.tiempoMaxSeg, 20));
  const envios = (await api<{ envios: { tipo: string; intentos: number; estado: string; cadId: string }[] }>(`/v1/admin/cads/${o.cadId}/bandeja?folio=${encodeURIComponent(d)}`, { token: sup })).body.envios ?? [];
  const alta = envios.find((e) => e.tipo === 'incidente.creado' && e.cadId === o.cadId);
  anotar('reintentos', !!conAcuseD && !!alta && alta.estado === 'entregado' && alta.intentos >= 3, alta ? `alta entregada en el intento ${alta.intentos} (${alta.estado})` : 'sin registro de la entrega');

  if (o.registrar) {
    for (const [caso, r] of Object.entries(resultados)) await api(`/v1/admin/cads/${o.cadId}/casos/${caso}`, { token: sup, cuerpo: { ok: r.ok, detalle: r.detalle } });
    log('Resultados registrados en el alta del CAD.');
  }
  for (const caso of CASOS_PRUEBA_CAD) if (!resultados[caso.id]) anotar(caso.id, false, 'no se ejecutó');
  return resultados;
}
