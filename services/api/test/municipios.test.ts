import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AVISO_PRIVACIDAD_VERSION, CASOS_PRUEBA_CAD, TERMINOS_VERSION, firmar, municipioEn, municipioPorClave } from '@pol-iaq/shared';
import { crearApp } from '../src/main';
import { cargarConfig, hashClave } from '../src/config';
import { DespachadorCadService } from '../src/cad/despachador.service';
import { AlmacenMemoria } from '../src/almacen/almacen-memoria';
import { AlmacenPostgres } from '../src/almacen/almacen-postgres';
import { CARPETA_MIGRACIONES, migrar } from '../src/almacen/migraciones';
import type { Almacen } from '../src/almacen/almacen';
import { Pool } from 'pg';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { descifrarSecreto, huellaDeCabecera } from '../src/municipios/registro-cad.service';
import { SmsSimulado } from '../src/sms/sms';

/** Un punto dentro del municipio (búsqueda en rejilla sobre su geocerca). */
function puntoEn(clave: string) {
  const g = municipioPorClave(clave)!.geocerca;
  const xs = g.map((p) => p[0]); const ys = g.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  let mejor: { lat: number; lng: number } | null = null; let d = Infinity;
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
    const lng = x0 + ((x1 - x0) * i) / 40; const lat = y0 + ((y1 - y0) * j) / 40;
    if (municipioEn(lat, lng)?.clave !== clave) continue;
    const dd = (lng - cx) ** 2 + (lat - cy) ** 2;
    if (dd < d) { d = dd; mejor = { lat: +lat.toFixed(5), lng: +lng.toFixed(5) }; }
  }
  return mejor!;
}

const SECRETO_SJR = 's'.repeat(40);
const config = {
  ...cargarConfig({ NODE_ENV: 'test' }),
  despachoActivo: false,
  esperaAcuseSeg: 60,
  asignacionAutomatica: false,
  cads: {
    'cad-corregidora': { webhookUrl: 'http://localhost:9/no-usado', secreto: 'secreto-corregidora' },
    'cad-queretaro': { webhookUrl: 'http://localhost:9/no-usado', secreto: 'secreto-qro' },
    'cad-el-marques': { webhookUrl: 'http://localhost:9/no-usado', secreto: 'secreto-marques' },
    'c5-queretaro': { modo: 'consola' as const },
  },
  operadores: [
    { usuario: 'sup', nombre: 'Supervisión C5', cadIds: ['*'], claveHash: hashClave('clave-sup-123') },
    { usuario: 'sjr', nombre: 'Operadora SJR', cadIds: ['cad-san-juan-del-rio'], claveHash: hashClave('clave-sjr-123') },
  ],
};

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
async function basePostgresLimpia() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
  return AlmacenPostgres.conectar(TEST_DATABASE_URL!);
}
const ALMACENES: [string, () => Promise<Almacen>][] = [
  ['memoria', async () => new AlmacenMemoria()],
  ...(TEST_DATABASE_URL ? [['PostgreSQL', basePostgresLimpia] as [string, () => Promise<Almacen>]] : []),
];

describe.skipIf(!TEST_DATABASE_URL)('migración 006 en PostgreSQL', () => {
  it('completa municipio_clave de 3 a 5 dígitos en folios anteriores y no deja reescribir un cierre', async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const hasta005 = mkdtempSync(join(tmpdir(), 'mig-'));
      for (const f of readdirSync(CARPETA_MIGRACIONES).filter((x) => x < '006')) copyFileSync(join(CARPETA_MIGRACIONES, f), join(hasta005, f));
      await migrar(pool, hasta005);
      const { rows } = await pool.query("INSERT INTO ciudadano (telefono, nombre) VALUES ('+520000000000', 'Demo') RETURNING id");
      await pool.query(`INSERT INTO reporte (folio, ciudadano_id, incidente_id, prioridad, corporacion_sugerida, ubicacion, municipio_clave, cad_id, estado)
        VALUES ('QRO-014-2026-000777', $1, 'emergencia-medica', 'alta', 'cruz_roja', ST_SetSRID(ST_MakePoint(-100.39, 20.59), 4326)::geography, '014', 'cad-queretaro', 'cerrado')`, [rows[0].id]);
      expect(await migrar(pool)).toEqual(['006_municipios_interconexion.sql', '007_respaldo_cq_cias.sql', '008_alta_911.sql']);
      const r = await pool.query("SELECT municipio_clave FROM reporte WHERE folio = 'QRO-014-2026-000777'");
      expect(r.rows[0].municipio_clave).toBe('22014');
      await pool.query("INSERT INTO cierre_sesnsp (mes, cerrado_en, cerrado_por, filas, ajustes, foto) VALUES ('2026-01', now(), 'prueba', '[]', '[]', '{}')");
      await expect(pool.query("UPDATE cierre_sesnsp SET filas = '[1]' WHERE mes = '2026-01'")).rejects.toThrow(/congelado/);
      await expect(pool.query("DELETE FROM cierre_sesnsp WHERE mes = '2026-01'")).rejects.toThrow(/congelado/);
      expect((await pool.query("SELECT filas FROM cierre_sesnsp WHERE mes = '2026-01'")).rows[0].filas).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});

describe.each(ALMACENES)('interconexión con los 18 municipios (Modo A y Modo B), almacén en %s', (_n, nuevoAlmacen) => {
  let almacen: Almacen;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let sup: Record<string, string>;
  let sjr: Record<string, string>;
  let tel = 0;

  async function ciudadano() {
    const res = await http.post('/v1/auth/verificar').send({ telefono: `+52442555${String(++tel).padStart(4, '0')}`, codigo: '000000', nombre: 'Ciudadana Demo', aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION });
    return { authorization: `Bearer ${res.body.token as string}` };
  }
  async function reporte(clave: string, incidenteId = 'emergencia-medica') {
    const res = await http.post('/v1/reportes').set(await ciudadano()).send({ incidenteId, ubicacion: puntoEn(clave) });
    expect(res.status).toBe(201);
    return res.body;
  }
  const entrar = async (usuario: string, clave: string) => ({ authorization: `Bearer ${(await http.post('/v1/operador/sesion').send({ usuario, clave })).body.token as string}` });
  const accion = (auth: Record<string, string>, folio: string, body: object) => http.post(`/v1/operador/reportes/${folio}/acciones`).set(auth).send(body);
  function eventoCad(cadId: string, secreto: string, ev: Record<string, unknown>, cabeceras: Record<string, string> = {}) {
    const cuerpo = JSON.stringify({ eventoId: randomUUID(), ocurridoEn: new Date().toISOString(), ...ev });
    const ts = Math.floor(Date.now() / 1000);
    return http.post(`/v1/cad/${cadId}/eventos`).set({ 'content-type': 'application/json', 'x-poliaq-timestamp': String(ts), 'x-poliaq-firma': firmar(secreto, ts, cuerpo), ...cabeceras }).send(cuerpo);
  }
  const contacto = { nombre: 'Responsable técnico (demo)', correo: 'tecnico@example.com' };

  beforeAll(async () => {
    almacen = await nuevoAlmacen();
    app = await crearApp(config, { almacen, sms: new SmsSimulado() });
    await app.listen(0);
    http = request(app.getHttpServer());
    sup = await entrar('sup', 'clave-sup-123');
    sjr = await entrar('sjr', 'clave-sjr-123');
  });
  afterAll(async () => {
    await app?.close();
    await almacen?.cerrar();
  });

  it('guarda la clave INEGI de 5 dígitos sin cambiar el formato del folio', async () => {
    const r = await reporte('22006');
    expect(r.folio).toMatch(/^QRO-006-\d{4}-\d{6}$/);
    const creado = app.get(DespachadorCadService).bandeja.find((e) => e.evento.folio === r.folio)!;
    expect(creado.cadId).toBe('cad-corregidora');
    expect(creado.evento.tipo === 'incidente.creado' && creado.evento.datos.municipioClave).toBe('22006');
    const mun = await http.get('/v1/municipios');
    expect(mun.body).toHaveLength(18);
    expect(mun.body.map((m: { clave: string }) => m.clave)).toEqual(Array.from({ length: 18 }, (_, i) => `22${String(i + 1).padStart(3, '0')}`));
  });

  it('un municipio sin conectar va al CQ CIAS con su propia clave', async () => {
    const r = await reporte('22016');
    expect(r.folio).toMatch(/^QRO-016-/);
    const v = await http.get(`/v1/operador/reportes/${r.folio}`).set(sup);
    expect(v.body).toMatchObject({ cadId: 'c5-queretaro', municipioClave: '22016' });
  });

  it('alta en Modo B: pruebas, unidades, activación y despacho completo desde la consola', async () => {
    const lista = await http.get('/v1/admin/cads').set(sup);
    expect(lista.body.cads).toHaveLength(19);
    expect((await http.get('/v1/admin/cads').set(sjr)).status).toBe(403);
    const sinClave = await http.put('/v1/admin/cads/cad-san-juan-del-rio').set(sup).send({ nombre: 'CAD San Juan del Río', clave: '22014', modo: 'consola', contactoTecnico: contacto });
    expect(sinClave.status).toBe(400);
    const alta = await http.put('/v1/admin/cads/cad-san-juan-del-rio').set(sup).send({ nombre: 'CAD San Juan del Río', clave: '22016', modo: 'consola', contactoTecnico: contacto });
    expect(alta.status).toBe(200);
    expect(alta.body).toMatchObject({ estado: 'pruebas', modo: 'consola', clave: '22016', conectado: true });
    // Activar requiere unidades.
    expect((await http.post('/v1/admin/cads/cad-san-juan-del-rio/estado').set(sup).send({ estado: 'activo' })).body.codigo).toBe('sin_unidades');
    for (const [unidadId, tipo, corporacion, etiqueta] of [['SJR-P1', 'patrulla', 'policia_municipal', 'Patrulla SJR 1'], ['SJR-M1', 'motopatrulla', 'policia_municipal', 'Motopatrulla SJR 1'], ['SJR-A1', 'ambulancia', 'cruz_roja', 'Ambulancia SJR 1'], ['SJR-B1', 'bomberos', 'bomberos', 'Bomberos SJR 1']]) {
      expect((await http.post('/v1/operador/unidades').set(sjr).send({ unidadId, cadId: 'cad-san-juan-del-rio', tipo, corporacion, etiqueta })).status).toBe(200);
    }
    expect((await http.post('/v1/operador/unidades').set(sjr).send({ unidadId: 'X-1', cadId: 'cad-queretaro', tipo: 'patrulla', corporacion: 'policia_municipal', etiqueta: 'Ajena' })).status).toBe(403);
    expect((await http.post('/v1/operador/unidades').set(sjr).send({ unidadId: 'P-101', cadId: 'cad-san-juan-del-rio', tipo: 'patrulla', corporacion: 'policia_municipal', etiqueta: 'Duplicada' })).body.codigo).toBe('unidad_de_otro_cad');
    const unidades = (await http.get('/v1/operador/unidades').set(sjr)).body.unidades;
    expect(unidades.map((u: { tipo: string }) => u.tipo).sort()).toEqual(['ambulancia', 'bomberos', 'motopatrulla', 'patrulla']);
    expect((await http.post('/v1/admin/cads/cad-san-juan-del-rio/estado').set(sup).send({ estado: 'activo' })).body.estado).toBe('activo');

    const r = await reporte('22016');
    expect(r.folio).toMatch(/^QRO-016-/);
    const bandeja = (await http.get('/v1/operador/reportes').set(sjr)).body.reportes;
    expect(bandeja.map((x: { folio: string }) => x.folio)).toContain(r.folio);
    expect((await accion(sjr, r.folio, { accion: 'recibir' })).body.estado).toBe('validado');
    const asignado = await accion(sjr, r.folio, { accion: 'asignar', unidadId: 'SJR-A1', etaMinutos: 9 });
    expect(asignado.body).toMatchObject({ estado: 'asignado', unidad: { unidadId: 'SJR-A1', etaMinutos: 9 } });
    expect((await accion(sjr, r.folio, { accion: 'mensaje', texto: 'La ambulancia va en camino.' })).status).toBe(200);
    expect((await accion(sjr, r.folio, { accion: 'estado', estado: 'en_camino' })).body.estado).toBe('en_camino');
    const recl = await accion(sjr, r.folio, { accion: 'reclasificar', codigoCnie: '10109', motivo: 'Corrección del operador' });
    expect(recl.status).toBe(200);
    expect(recl.body.correccionesCnie.at(-1)).toMatchObject({ a: '10109', actor: 'operador:sjr' });
    // Transferir a un municipio que no está conectado no se permite; al C5, sí.
    expect((await accion(sjr, r.folio, { accion: 'transferir', cadDestinoId: 'cad-tequisquiapan' })).body.codigo).toBe('cad_destino_no_conectado');
    expect((await accion(sjr, r.folio, { accion: 'transferir', cadDestinoId: 'c5-queretaro', motivo: 'Apoyo estatal' })).body).toMatchObject({ cadId: 'c5-queretaro', municipioClave: '22016' });
  });

  it('sin capacidad (sin unidades o sin operador) el reporte va al CQ CIAS desde su creación, con el motivo', async () => {
    // Tequisquiapan en Modo B sin unidades: conectado pero sin capacidad.
    expect((await http.put('/v1/admin/cads/cad-tequisquiapan').set(sup).send({ nombre: 'CAD Tequisquiapan', clave: '22017', modo: 'consola', contactoTecnico: contacto })).body).toMatchObject({ conectado: true, sinCapacidad: 'sin unidades en servicio' });
    const t = await reporte('22017');
    const vt = (await http.get(`/v1/operador/reportes/${t.folio}`).set(sup)).body;
    expect(vt).toMatchObject({ cadId: 'c5-queretaro', municipioClave: '22017', ruta: { cadOrigen: 'c5-queretaro', motivo: 'sin_capacidad', detalle: 'sin unidades en servicio', canal: '911' } });
    expect(vt.respaldo).toBe('Atiende CQ CIAS — municipio sin capacidad (sin unidades en servicio)');
    expect(vt.historial[0]).toMatchObject({ estado: 'recibido', nota: vt.respaldo });

    // San Juan del Río (activo, con unidades) sin operador disponible: también al CQ CIAS; al quitarlo, vuelve a su CAD.
    expect((await http.post('/v1/operador/cads/cad-queretaro/disponibilidad').set(sjr).send({ sinOperador: true })).status).toBe(403);
    expect((await http.post('/v1/operador/cads/cad-san-juan-del-rio/disponibilidad').set(sjr).send({ sinOperador: true })).body).toMatchObject({ sinCapacidad: 'sin operador disponible' });
    const s1 = await reporte('22016');
    expect((await http.get(`/v1/operador/reportes/${s1.folio}`).set(sup)).body).toMatchObject({ cadId: 'c5-queretaro', ruta: { motivo: 'sin_capacidad', detalle: 'sin operador disponible' }, respaldo: 'Atiende CQ CIAS — municipio sin capacidad (sin operador disponible)' });
    expect((await http.get('/v1/operador/yo').set(sjr)).body.cads.find((c: { id: string }) => c.id === 'cad-san-juan-del-rio')).toMatchObject({ sinOperador: true, sinCapacidad: 'sin operador disponible' });
    expect((await http.post('/v1/operador/cads/cad-san-juan-del-rio/disponibilidad').set(sjr).send({ sinOperador: false })).body.sinCapacidad).toBeNull();
    const s2 = await reporte('22016');
    expect((await http.get(`/v1/operador/reportes/${s2.folio}`).set(sup)).body).toMatchObject({ cadId: 'cad-san-juan-del-rio', ruta: { cadOrigen: 'cad-san-juan-del-rio', motivo: null }, respaldo: null });
    const bitacora = (await http.get('/v1/admin/auditoria?folio=').set(sup)).body.entradas ?? [];
    expect(Array.isArray(bitacora)).toBe(true);
  });

  it('reporte anónimo: va por el 089 al CQ CIAS y no lleva datos personales al folio ni al CSV', async () => {
    const res = await http.post('/v1/reportes').set(await ciudadano()).send({ incidenteId: 'ruido-rina', identidad: 'anonimo', ubicacion: puntoEn('22006') });
    expect(res.status).toBe(201);
    const v = (await http.get(`/v1/operador/reportes/${res.body.folio}`).set(sup)).body;
    expect(v).toMatchObject({ cadId: 'c5-queretaro', municipioClave: '22006', ruta: { canal: '089', motivo: 'anonimo_089' }, reportante: { nombre: 'Anónimo', telefono: '' } });
    expect(v.respaldo).toBe('Atiende CQ CIAS — reporte anónimo (089)');
    const alta = app.get(DespachadorCadService).bandeja.find((e) => e.evento.folio === res.body.folio && e.evento.tipo === 'incidente.creado')!;
    expect(alta.cadId).toBe('c5-queretaro');
    expect(JSON.stringify(alta.evento)).not.toMatch(/Ciudadana Demo|\+52442555/);
    const guardado = (await almacen.reporte(res.body.folio))!;
    expect(JSON.stringify({ ...guardado, ciudadanoId: undefined })).not.toMatch(/Ciudadana Demo|\+52442555/);
    const hoy = new Date().toISOString().slice(0, 10);
    const csv = (await http.get(`/v1/operador/estadistica/folios.csv?municipio=22006&periodo=mensual&fecha=${hoy}`).set(sup)).text;
    const fila = csv.split('\r\n').find((l) => l.startsWith(res.body.folio))!;
    expect(fila).toContain(',CQ CIAS,CQ CIAS,reporte anónimo (089),089,');
    expect(csv).not.toMatch(/Ciudadana Demo|\+52|C5/);
  });

  it('alta en Modo A: secreto cifrado, 8 casos antes de producción, IPs y mTLS', async () => {
    const sinSecreto = await http.put('/v1/admin/cads/cad-tequisquiapan').set(sup).send({ nombre: 'CAD Tequisquiapan', clave: '22017', modo: 'webhook', webhookUrl: 'https://cad.example.com/poliaq', contactoTecnico: contacto });
    expect(sinSecreto.body.codigo).toBe('falta_secreto');
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const der = publicKey.export({ type: 'spki', format: 'der' });
    // Huella de un "certificado" de prueba (los bytes DER bastan para la huella).
    const huella = createHash('sha256').update(der).digest('hex');
    const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----`;
    expect(huellaDeCabecera(encodeURIComponent(pem))).toBe(huella);
    expect(huellaDeCabecera(`By=spiffe://x;Hash=${huella.toUpperCase()};Subject="CN=cad"`)).toBe(huella);

    const alta = await http.put('/v1/admin/cads/cad-tequisquiapan').set(sup).send({
      nombre: 'CAD Tequisquiapan', clave: '22017', modo: 'webhook', webhookUrl: 'https://cad.example.com/poliaq', secreto: SECRETO_SJR,
      certificadoSha256: huella.match(/../g)!.join(':').toUpperCase(), ipsPermitidas: ['127.0.0.0/8', '::1'], contactoTecnico: contacto,
    });
    expect(alta.status).toBe(200);
    expect(alta.body).toMatchObject({ estado: 'pruebas', tieneSecreto: true, certificadoSha256: huella });
    expect(JSON.stringify(alta.body)).not.toContain(SECRETO_SJR);
    const guardado = (await almacen.registrosCad()).find((x) => x.cadId === 'cad-tequisquiapan')!;
    expect(guardado.secretoCifrado).not.toContain(SECRETO_SJR);
    expect(descifrarSecreto(config.secretoTokens, guardado.secretoCifrado!)).toBe(SECRETO_SJR);

    const pendiente = await http.post('/v1/admin/cads/cad-tequisquiapan/estado').set(sup).send({ estado: 'activo' });
    expect(pendiente.body).toMatchObject({ codigo: 'casos_pendientes' });
    expect(pendiente.body.faltan).toHaveLength(8);

    const r = await reporte('22017');
    expect(r.folio).toMatch(/^QRO-017-/);
    // Sin certificado (MTLS_REQUIRED apagado en pruebas) pasa; con otro certificado, no.
    expect((await eventoCad('cad-tequisquiapan', SECRETO_SJR, { folio: r.folio, secuencia: 1, tipo: 'incidente.recibido', datos: { folioCad: 'TX-1' } })).status).toBe(202);
    expect((await eventoCad('cad-tequisquiapan', SECRETO_SJR, { folio: r.folio, secuencia: 2, tipo: 'mensaje.operador', datos: { texto: 'x', autor: 'y' } }, { 'x-client-cert': `Hash=${'0'.repeat(64)}` })).body.codigo).toBe('certificado_invalido');
    expect((await eventoCad('cad-tequisquiapan', SECRETO_SJR, { folio: r.folio, secuencia: 2, tipo: 'mensaje.operador', datos: { texto: 'Hola', autor: 'CAD' } }, { 'x-client-cert': `Hash=${huella}` })).status).toBe(202);

    // IP fuera de la lista.
    await http.put('/v1/admin/cads/cad-tequisquiapan').set(sup).send({ nombre: 'CAD Tequisquiapan', clave: '22017', modo: 'webhook', webhookUrl: 'https://cad.example.com/poliaq', ipsPermitidas: ['10.0.0.0/8'], contactoTecnico: contacto });
    expect((await eventoCad('cad-tequisquiapan', SECRETO_SJR, { folio: r.folio, secuencia: 3, tipo: 'mensaje.operador', datos: { texto: 'x', autor: 'y' } })).body.codigo).toBe('ip_no_permitida');
    await http.put('/v1/admin/cads/cad-tequisquiapan').set(sup).send({ nombre: 'CAD Tequisquiapan', clave: '22017', modo: 'webhook', webhookUrl: 'https://cad.example.com/poliaq', ipsPermitidas: [], contactoTecnico: contacto });

    for (const c of CASOS_PRUEBA_CAD) expect((await http.post(`/v1/admin/cads/cad-tequisquiapan/casos/${c.id}`).set(sup).send({ ok: true, detalle: 'suite de certificación' })).status).toBe(200);
    expect((await http.post('/v1/admin/cads/cad-tequisquiapan/estado').set(sup).send({ estado: 'activo' })).body).toMatchObject({ estado: 'activo', casosPendientes: [] });
    // Suspendido: deja de recibir reportes (van al C5) y sus llamadas se rechazan.
    await http.post('/v1/admin/cads/cad-tequisquiapan/estado').set(sup).send({ estado: 'suspendido', motivo: 'mantenimiento' });
    expect((await eventoCad('cad-tequisquiapan', SECRETO_SJR, { folio: r.folio, secuencia: 4, tipo: 'mensaje.operador', datos: { texto: 'x', autor: 'y' } })).body.codigo).toBe('cad_suspendido');
    const alC5 = await reporte('22017');
    expect((await http.get(`/v1/operador/reportes/${alC5.folio}`).set(sup)).body.cadId).toBe('c5-queretaro');
    await http.post('/v1/admin/cads/cad-tequisquiapan/estado').set(sup).send({ estado: 'activo' });
  });

  it('migra San Juan del Río de Modo B a Modo A sin perder folios, CNIE ni historial', async () => {
    const r = await reporte('22016');
    await accion(sjr, r.folio, { accion: 'recibir' });
    await accion(sjr, r.folio, { accion: 'asignar', unidadId: 'SJR-P1', etaMinutos: 5 });
    const antes = (await http.get(`/v1/operador/reportes/${r.folio}`).set(sup)).body;
    expect((await http.post('/v1/admin/cads/cad-san-juan-del-rio/migrar').set(sup).send({ webhookUrl: 'https://cad-sjr.example.com/poliaq', secreto: SECRETO_SJR })).body.codigo).toBe('casos_pendientes');
    for (const c of CASOS_PRUEBA_CAD) await http.post(`/v1/admin/cads/cad-san-juan-del-rio/casos/${c.id}`).set(sup).send({ ok: true });
    const mig = await http.post('/v1/admin/cads/cad-san-juan-del-rio/migrar').set(sup).send({ webhookUrl: 'https://cad-sjr.example.com/poliaq', secreto: SECRETO_SJR });
    expect(mig.status).toBe(200);
    expect(mig.body).toMatchObject({ modo: 'webhook', estado: 'activo' });
    expect(mig.body.foliosReenviados).toContain(r.folio);
    const reenvio = app.get(DespachadorCadService).bandeja.filter((e) => e.evento.folio === r.folio && e.evento.tipo === 'incidente.creado').at(-1)!;
    expect(reenvio.cadId).toBe('cad-san-juan-del-rio');
    expect(reenvio.evento.tipo === 'incidente.creado' && reenvio.evento.datos.estadoActual).toMatchObject({ estado: 'asignado', unidad: { unidadId: 'SJR-P1' } });
    const despues = (await http.get(`/v1/operador/reportes/${r.folio}`).set(sup)).body;
    expect(despues.historial).toEqual(antes.historial);
    expect(despues.cnie).toEqual(antes.cnie);
    // El CAD empieza su secuencia en 1 y se acepta; su acuse no rompe el estado en curso.
    expect((await eventoCad('cad-san-juan-del-rio', SECRETO_SJR, { folio: r.folio, secuencia: 1, tipo: 'incidente.recibido', datos: { folioCad: 'SJR-900' } })).status).toBe(202);
    expect((await eventoCad('cad-san-juan-del-rio', SECRETO_SJR, { folio: r.folio, secuencia: 2, tipo: 'unidad.posicion', datos: { unidadId: 'SJR-P1', lat: 20.39, lng: -99.99, etaMinutos: 3 } })).status).toBe(202);
    const fin = (await http.get(`/v1/operador/reportes/${r.folio}`).set(sup)).body;
    expect(fin).toMatchObject({ estado: 'en_camino', folioCad: 'SJR-900', operable: false });
    // La consola ya no la opera: despacha su CAD.
    expect((await accion(sjr, r.folio, { accion: 'mensaje', texto: 'x' })).body.codigo).toBe('cad_con_sistema_propio');
  });

  it('estadística por municipio, periodo, CNIE, corporación y unidad, sin datos personales en el CSV', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const e = await http.get(`/v1/operador/estadistica?municipio=22016&periodo=mensual&fecha=${hoy}`).set(sup);
    expect(e.status).toBe(200);
    expect(e.body.porMunicipio.map((g: { clave: string }) => g.clave)).toEqual(['22016']);
    expect(e.body.reportes).toBeGreaterThanOrEqual(3);
    expect(e.body.porCorporacion.map((g: { clave: string }) => g.clave)).toEqual(expect.arrayContaining(['policia_municipal']));
    expect(e.body.porUnidad.length).toBeGreaterThan(0);
    expect(e.body.porCad.map((g: { clave: string }) => g.clave)).toEqual(expect.arrayContaining(['c5-queretaro', 'cad-san-juan-del-rio']));
    expect((await http.get('/v1/operador/estadistica?municipio=014').set(sup)).status).toBe(200);
    expect((await http.get('/v1/operador/estadistica?municipio=99001').set(sup)).status).toBe(400);
    const propia = await http.get('/v1/operador/estadistica').set(sjr);
    expect(propia.body.porCad.every((g: { clave: string }) => g.clave === 'cad-san-juan-del-rio')).toBe(true);
    const csv = await http.get(`/v1/operador/estadistica/folios.csv?municipio=22016&periodo=mensual&fecha=${hoy}`).set(sup);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(',22016,San Juan del Río,');
    expect(csv.text).not.toMatch(/\+52|Ciudadana Demo/);
    // Origen y responsable actual en columnas separadas; la tabla agrupa por el responsable actual.
    expect(csv.text.split('\r\n')[0]).toContain('municipio,cad_origen,cad_responsable_actual,motivo_respaldo,canal,estado');
    expect(e.body.porCadOrigen.length).toBeGreaterThan(0);
    const c5 = e.body.porCad.find((g: { clave: string }) => g.clave === 'c5-queretaro');
    expect(c5.deOtroCad).toBeGreaterThanOrEqual(1); // el folio que San Juan del Río transfirió al CQ CIAS
  });

  it('reporte mensual al SESNSP: borrador, cierre congelado y correcciones en el mes siguiente', async () => {
    // Folios de un mes pasado (solo datos de demostración).
    const base = (await almacen.reportesEntre(['*'], null, null)).find((x) => x.municipioClave === '22016')!;
    const viejo = { ...structuredClone(base), folio: 'QRO-016-2026-900001', creadoEn: '2026-10-10T18:00:00.000Z', actualizadoEn: '2026-10-10T18:00:00.000Z', estado: 'cerrado' as const, cadId: 'c5-queretaro' };
    await almacen.guardarReporte(viejo);
    expect((await http.get('/v1/operador/sesnsp').set(sjr)).status).toBe(403);
    const mesActual = (await http.get('/v1/operador/sesnsp').set(sup)).body.mesActual;
    expect((await http.post(`/v1/operador/sesnsp/${mesActual}/cerrar`).set(sup)).body.codigo).toBe('mes_en_curso');
    const borrador = await http.get('/v1/operador/sesnsp/2026-10').set(sup);
    expect(borrador.body).toMatchObject({ estado: 'borrador', mes: '2026-10' });
    expect(borrador.body.filas[0]).toMatchObject({ mes: '2026-10', claveMunicipio: '22016', total: 1, procedentes: 1, improcedentesCancelados: 0 });
    const cierre = await http.post('/v1/operador/sesnsp/2026-10/cerrar').set(sup);
    expect(cierre.body).toMatchObject({ estado: 'cerrado' });
    expect((await http.post('/v1/operador/sesnsp/2026-10/cerrar').set(sup)).body.codigo).toBe('mes_ya_cerrado');
    const xlsx = await http.get('/v1/operador/sesnsp/2026-10/reporte.xlsx').set(sup).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const csv = await http.get('/v1/operador/sesnsp/2026-10/reporte.csv').set(sup);
    expect(csv.text).toContain('2026-10,22016,San Juan del Río');
    expect(csv.text).not.toContain('QRO-016');

    // Después del cierre el folio resulta improcedente: octubre no cambia y la corrección sale en noviembre.
    await almacen.guardarReporte({ ...viejo, estado: 'improcedente' });
    expect((await http.get('/v1/operador/sesnsp/2026-10').set(sup)).body.filas[0]).toMatchObject({ procedentes: 1, improcedentesCancelados: 0 });
    const nov = await http.get('/v1/operador/sesnsp/2026-11').set(sup);
    expect(nov.body.ajustes).toEqual([expect.objectContaining({ mesOrigen: '2026-10', claveMunicipio: '22016', deltaProcedentes: -1, deltaImprocedentesCancelados: 1, deltaTotal: 0 })]);
    expect(nov.body.ajustes[0].nota).toContain('Corrección del 2026-10');
  });

  it('SESNSP: un folio abierto no mueve las medianas con el reloj y un mes cerrado exporta siempre el mismo archivo', async () => {
    // Folio de septiembre que sigue abierto (asignado, sin salir): la etapa "salida" corre con el reloj.
    const base = (await almacen.reporte((await almacen.reportesEntre(['*'], null, null))[0].folio))!;
    const abierto = {
      ...structuredClone(base), folio: 'QRO-014-2026-900002', municipioClave: '22014', estado: 'asignado' as const, cadId: 'cad-queretaro', creadoEn: '2026-09-05T18:00:00.000Z', actualizadoEn: '2026-09-05T18:06:00.000Z',
      historial: [{ estado: 'recibido' as const, en: '2026-09-05T18:00:00.000Z' }, { estado: 'validado' as const, en: '2026-09-05T18:01:00.000Z' }, { estado: 'asignado' as const, en: '2026-09-05T18:03:00.000Z' }],
    };
    await almacen.guardarReporte(abierto);
    const b1 = await http.get('/v1/operador/sesnsp/2026-09/reporte.csv').set(sup);
    await new Promise((r) => setTimeout(r, 1200));
    const b2 = await http.get('/v1/operador/sesnsp/2026-09/reporte.csv').set(sup);
    expect(b1.headers['content-disposition']).toContain('sesnsp-2026-09-borrador.csv');
    expect(b2.text).toBe(b1.text);
    const fila = b1.text.split('\r\n').find((l) => l.startsWith('2026-09,22014'))!.split(',');
    // recepción 60 s, asignación 120 s; salida, traslado y llegada siguen abiertas: vacías (no cuentan con el reloj).
    expect(fila.slice(-5)).toEqual(['60', '120', '', '', '']);
    expect((await http.post('/v1/operador/sesnsp/2026-09/cerrar').set(sup)).body.estado).toBe('cerrado');
    const c1 = await http.get('/v1/operador/sesnsp/2026-09/reporte.csv').set(sup);
    await almacen.guardarReporte({ ...abierto, estado: 'en_camino', historial: [...abierto.historial, { estado: 'en_camino', en: '2026-09-05T18:05:00.000Z' }] });
    await new Promise((r) => setTimeout(r, 1200));
    const c2 = await http.get('/v1/operador/sesnsp/2026-09/reporte.csv').set(sup);
    expect(c1.headers['content-disposition']).toContain('sesnsp-2026-09-cerrado.csv');
    expect(Buffer.from(c2.text).equals(Buffer.from(c1.text))).toBe(true);
    expect((await http.get('/v1/operador/sesnsp/2026-09').set(sup)).body).toMatchObject({ estado: 'cerrado' });
  });

  it('versión pública agregada sin datos personales', async () => {
    const res = await http.get(`/v1/publico/tiempos?periodo=mensual&fecha=${new Date().toISOString().slice(0, 10)}`);
    expect(res.status).toBe(200);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/QRO-\d{3}-|\+52|Ciudadana|SJR-|lat/);
    expect(res.body.nota).toContain('sin información personal');
  });
});
