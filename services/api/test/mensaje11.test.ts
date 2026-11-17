import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION, municipioEn, municipioPorClave } from '@pol-iaq/shared';
import { crearApp } from '../src/main';
import { cargarConfig, hashClave } from '../src/config';
import { AlmacenMemoria } from '../src/almacen/almacen-memoria';
import { SmsSimulado } from '../src/sms/sms';

/** Un punto dentro del municipio. */
function puntoEn(clave: string) {
  const g = municipioPorClave(clave)!.geocerca;
  const xs = g.map((p) => p[0]); const ys = g.map((p) => p[1]);
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
    const lng = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 40;
    const lat = Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 40;
    if (municipioEn(lat, lng)?.clave === clave) return { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
  }
  throw new Error(clave);
}

const config = {
  ...cargarConfig({ NODE_ENV: 'test' }),
  despachoActivo: false,
  esperaAcuseSeg: 60,
  asignacionAutomatica: false,
  cads: { 'cad-queretaro': { modo: 'consola' as const }, 'c5-queretaro': { modo: 'consola' as const } },
  operadores: [
    { usuario: 'sup', nombre: 'Supervisión C5', cadIds: ['*'], claveHash: hashClave('clave-sup-123') },
    { usuario: 'qro', nombre: 'Operadora Querétaro', cadIds: ['cad-queretaro'], claveHash: hashClave('clave-qro-123') },
  ],
};

describe('Mensaje 11: Mal Uso solo operador, bandeja, alta 911 y tabla de folios', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let sup: Record<string, string>;
  let qro: Record<string, string>;
  let app911: { folio: string } | null = null;

  const ciudadano = async (telefono: string, nombre: string) => {
    const res = await http.post('/v1/auth/verificar').send({ telefono, codigo: '000000', nombre, aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION });
    return { authorization: `Bearer ${res.body.token as string}` };
  };
  const entrar = async (usuario: string, clave: string) => ({ authorization: `Bearer ${(await http.post('/v1/operador/sesion').send({ usuario, clave })).body.token as string}` });
  const accion = (auth: Record<string, string>, folio: string, body: object) => http.post(`/v1/operador/reportes/${folio}/acciones`).set(auth).send(body);

  beforeAll(async () => {
    app = await crearApp(config, { almacen: new AlmacenMemoria(), sms: new SmsSimulado() });
    await app.listen(0);
    http = request(app.getHttpServer());
    sup = await entrar('sup', 'clave-sup-123');
    qro = await entrar('qro', 'clave-qro-123');
  });
  afterAll(async () => { await app?.close(); });

  it('A: el ciudadano no puede levantar Mal Uso del servicio', async () => {
    const c = await ciudadano('+524425550001', 'Ana App');
    const res = await http.post('/v1/reportes').set(c).send({ incidenteId: 'otro', codigoCnie: '70107', ubicacion: puntoEn('22014') });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('cnie_solo_operador');
    // Los demás tipos sí.
    expect((await http.post('/v1/reportes').set(c).send({ incidenteId: 'otro', codigoCnie: '30202', ubicacion: puntoEn('22014') })).status).toBe(201);
  });

  it('A: solo el operador recataloga, con motivo obligatorio; queda en el historial y cuenta como improcedente', async () => {
    const c = await ciudadano('+524425550002', 'Beto Broma');
    const r = (await http.post('/v1/reportes').set(c).send({ incidenteId: 'agresion', ubicacion: puntoEn('22014') })).body;
    expect((await accion(qro, r.folio, { accion: 'reclasificar', codigoCnie: '70107' })).body.codigo).toBe('usar_recatalogar_mal_uso');
    expect((await accion(qro, r.folio, { accion: 'recatalogar_mal_uso', codigoCnie: '70107', motivo: '' })).status).toBe(400);
    expect((await accion(qro, r.folio, { accion: 'recatalogar_mal_uso', codigoCnie: '30202', motivo: 'no aplica' })).body.codigo).toBe('no_es_mal_uso');
    const ok = await accion(qro, r.folio, { accion: 'recatalogar_mal_uso', codigoCnie: '70107', motivo: 'Broma verificada al devolver la llamada' });
    expect(ok.status).toBe(200);
    expect(ok.body.cnie).toMatchObject({ tipo: { codigo: '7' }, incidente: { codigo: '70107' }, origen: 'operador' });
    expect(ok.body.correccionesCnie.at(-1)).toMatchObject({ de: '30909', a: '70107', tipoDe: '3', tipoA: '7', malUso: true, motivo: 'Broma verificada al devolver la llamada', actor: 'operador:qro' });
    expect(ok.body.estado).toBe('recibido');
    expect(ok.body.historial.at(-1).nota).toMatch(/Recatalogado a Mal Uso del servicio \(Improcedentes\) por Operadora Querétaro: tipo 3 Seguridad \(30909\) → 7 .*\(70107\)\. Motivo: Broma verificada/);
    expect(ok.body.historial[0].estado).toBe('recibido');
    const hoy = new Date().toISOString().slice(0, 10);
    const e = (await http.get(`/v1/operador/estadistica?municipio=22014&periodo=mensual&fecha=${hoy}`).set(sup)).body;
    expect(e.improcedentes).toBeGreaterThanOrEqual(1);
    const mes = hoy.slice(0, 7);
    const s = (await http.get(`/v1/operador/sesnsp/${mes}`).set(sup)).body;
    expect(s.filas.find((f: { incidente: string }) => f.incidente === '70107')).toMatchObject({ total: 1, procedentes: 0, improcedentesCancelados: 1 });
  });

  it('B: la consola recibe los umbrales del semáforo; los valores inválidos no arrancan el API', async () => {
    expect((await http.get('/v1/operador/yo').set(sup)).body.semaforo).toEqual({ amarillo: 0.5, rojo: 1 });
    expect(cargarConfig({ NODE_ENV: 'test', SEMAFORO_AMARILLO: '0.3', SEMAFORO_ROJO: '0.9' }).semaforo).toEqual({ amarillo: 0.3, rojo: 0.9 });
    expect(() => cargarConfig({ NODE_ENV: 'test', SEMAFORO_AMARILLO: '1', SEMAFORO_ROJO: '0.5' })).toThrow(/SEMAFORO/);
  });

  it('C: alta por 911 con número registrado (carga sus datos) y con número nuevo (lo da de alta)', async () => {
    const registrado = (await http.get('/v1/operador/reportantes/442%20555%200001').set(sup)).body;
    expect(registrado).toMatchObject({ telefono: '4425550001', registrado: true, reportante: { nombre: 'Ana App', origen: 'app' } });
    const a = await http.post('/v1/operador/reportes/911').set(sup).send({ telefono: '4425550001', tipoTelefono: 'celular', incidenteId: 'robo-en-curso', ubicacion: puntoEn('22014'), respuestas: [{ preguntaId: 'armas', respuesta: true }] });
    expect(a.status).toBe(201);
    expect(a.body.reportanteNuevo).toBe(false);
    expect(a.body.reporte).toMatchObject({ origen: '911', tipoTelefono: 'celular', cadId: 'cad-queretaro', municipioClave: '22014', reportante: { nombre: 'Ana App', telefono: '+524425550001' } });
    expect(a.body.reporte.folio).toMatch(/^QRO-014-\d{4}-\d{6}$/);
    expect(a.body.reporte.historial[0].nota).toMatch(/Alta por llamada al 911 \(celular\), capturada por Supervisión C5/);
    expect(a.body.reporte.cuestionario.transcripcion).toMatch(/arma/i);

    expect((await http.get('/v1/operador/reportantes/4429990000').set(sup)).body.registrado).toBe(false);
    expect((await http.post('/v1/operador/reportes/911').set(sup).send({ telefono: '4429990000', tipoTelefono: 'fijo', incidenteId: 'incendio', ubicacion: puntoEn('22016') })).body.codigo).toBe('falta_nombre');
    const b = await http.post('/v1/operador/reportes/911').set(sup).send({ telefono: '+52 442 999 0000', nombre: 'Carla Fijo', tipoTelefono: 'fijo', incidenteId: 'incendio', ubicacion: puntoEn('22016'), prioridad: 'media' });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ reportanteNuevo: true, reporte: { origen: '911', tipoTelefono: 'fijo', prioridad: 'media', cadId: 'c5-queretaro', municipioClave: '22016' } });
    expect(b.body.reporte.folio).toMatch(/^QRO-016-/);
    app911 = b.body.reporte;
    expect((await http.get('/v1/operador/reportantes/4429990000').set(sup)).body).toMatchObject({ registrado: true, reportante: { nombre: 'Carla Fijo', origen: '911' } });
    const c = await http.post('/v1/operador/reportes/911').set(sup).send({ telefono: '4429990000', tipoTelefono: 'fijo', incidenteId: 'ruido-rina', ubicacion: puntoEn('22016') });
    expect(c.body.reportanteNuevo).toBe(false);
    // Mal Uso no se asigna al crear: se recataloga después de verificar.
    expect((await http.post('/v1/operador/reportes/911').set(sup).send({ telefono: '4429990000', tipoTelefono: 'fijo', incidenteId: 'otro', codigoCnie: '70101', ubicacion: puntoEn('22016') })).body.codigo).toBe('cnie_solo_recatalogar');
    expect((await http.post('/v1/operador/reportes/911').set(sup).send({ telefono: '123', tipoTelefono: 'fijo', incidenteId: 'otro', ubicacion: puntoEn('22016') })).status).toBe(400);
  });

  it('B: cada municipio ve solo lo suyo en su bandeja; supervisión ve todos', async () => {
    const delQro = (await http.get('/v1/operador/reportes?todos=1').set(qro)).body.reportes as { cadId: string; folio: string }[];
    expect(delQro.length).toBeGreaterThan(0);
    expect(delQro.every((r) => r.cadId === 'cad-queretaro')).toBe(true);
    expect(delQro.some((r) => r.folio === app911!.folio)).toBe(false);
    const todos = (await http.get('/v1/operador/reportes?todos=1').set(sup)).body.reportes as { folio: string; origen: string }[];
    expect(todos.find((r) => r.folio === app911!.folio)?.origen).toBe('911');
  });

  it('D: tabla de folios con nombre, teléfono, canal y tipo de teléfono; solo lo del operador', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const f = (await http.get(`/v1/operador/estadistica/folios?periodo=mensual&fecha=${hoy}`).set(sup)).body.filas as Record<string, unknown>[];
    expect(f.find((x) => x.folio === app911!.folio)).toMatchObject({ canal: '911', tipoTelefono: 'fijo', nombre: 'Carla Fijo', telefono: '+524429990000', municipioClave: '22016' });
    expect(f.some((x) => x.canal === 'app' && x.nombre === 'Ana App')).toBe(true);
    const q = (await http.get(`/v1/operador/estadistica/folios?periodo=mensual&fecha=${hoy}`).set(qro)).body.filas as { cadId: string }[];
    expect(q.every((x) => x.cadId === 'cad-queretaro')).toBe(true);
  });
});
