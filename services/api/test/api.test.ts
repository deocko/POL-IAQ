import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION, firmar } from '@pol-iaq/shared';
import { crearApp } from '../src/main';
import { cargarConfig } from '../src/config';
import { DespachadorCadService } from '../src/cad/despachador.service';

const SECRETO_CORR = 'secreto-corregidora';
const config = {
  ...cargarConfig({ NODE_ENV: 'test' }),
  despachoActivo: false,
  esperaAcuseSeg: 0.3,
  cads: {
    'cad-corregidora': { webhookUrl: 'http://localhost:9/no-usado', secreto: SECRETO_CORR },
    'cad-queretaro': { webhookUrl: 'http://localhost:9/no-usado', secreto: 'secreto-qro' },
    'cad-el-marques': { webhookUrl: 'http://localhost:9/no-usado', secreto: 'secreto-marques' },
    'c5-queretaro': { webhookUrl: 'http://localhost:9/no-usado', secreto: 'secreto-c5' },
  },
};

let app: INestApplication;
let http: ReturnType<typeof request>;
let url: string;

async function registrar(telefono: string) {
  const res = await http.post('/v1/auth/verificar').send({ telefono, codigo: '000000', nombre: 'Ciudadana Prueba', aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

function eventoCad(cadId: string, secreto: string, ev: Record<string, unknown>) {
  const cuerpo = JSON.stringify({ eventoId: randomUUID(), ocurridoEn: new Date().toISOString(), ...ev });
  const ts = Math.floor(Date.now() / 1000);
  return http.post(`/v1/cad/${cadId}/eventos`).set('content-type', 'application/json').set('x-poliaq-timestamp', String(ts)).set('x-poliaq-firma', firmar(secreto, ts, cuerpo)).send(cuerpo);
}

beforeAll(async () => {
  app = await crearApp(config);
  await app.listen(0);
  url = await app.getUrl();
  http = request(app.getHttpServer());
});
afterAll(async () => app?.close());

describe('registro y avisos legales', () => {
  it('rechaza versiones legales desactualizadas', async () => {
    const res = await http.post('/v1/auth/verificar').send({ telefono: '+524421111111', codigo: '000000', nombre: 'Prueba', aceptaAvisoPrivacidad: '2020-01-01', aceptaTerminos: TERMINOS_VERSION });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('version_legal_desactualizada');
  });
  it('exige token para reportar', async () => {
    expect((await http.get('/v1/reportes')).status).toBe(401);
  });
});

describe('flujo de punta a punta con el CAD de Corregidora', () => {
  it('crea, despacha y sigue el reporte en tiempo real', async () => {
    const token = await registrar('+524422222222');
    const auth = { authorization: `Bearer ${token}` };

    const creado = await http.post('/v1/reportes').set(auth).send({ incidenteId: 'robo-en-curso', ubicacion: { lat: 20.539, lng: -100.442 }, respuestas: { armas: false } });
    expect(creado.status).toBe(201);
    const folio: string = creado.body.folio;
    expect(folio).toMatch(/^QRO-006-\d{4}-\d{6}$/);

    const bandeja = app.get(DespachadorCadService).bandeja;
    const salida = bandeja.find((e) => e.evento.folio === folio);
    expect(salida?.cadId).toBe('cad-corregidora');
    expect(salida?.evento.tipo).toBe('incidente.creado');

    const socket = ioClient(`${url}/seguimiento`, { transports: ['websocket'] });
    const sus = await socket.emitWithAck('suscribir', { token, folio });
    expect(sus.ok).toBe(true);
    const actualizaciones: { estado: string }[] = [];
    socket.on('reporte.actualizado', (r) => actualizaciones.push(r));

    expect((await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 1, tipo: 'incidente.recibido', datos: { folioCad: 'CORR-778' } })).status).toBe(202);
    expect((await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 2, tipo: 'unidad.asignada', datos: { unidadId: 'P-12', corporacion: 'policia_municipal', etiqueta: 'Patrulla 12', etaMinutos: 7 } })).status).toBe(202);
    expect((await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 3, tipo: 'unidad.posicion', datos: { unidadId: 'P-12', lat: 20.54, lng: -100.44, etaMinutos: 5 } })).status).toBe(202);
    // Una posición vieja se descarta sin error.
    const vieja = await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 2, tipo: 'unidad.posicion', datos: { unidadId: 'P-12', lat: 0, lng: 0 } });
    expect(vieja.body.descartado).toBe('secuencia_antigua');

    const detalle = await http.get(`/v1/reportes/${folio}`).set(auth);
    expect(detalle.body.estado).toBe('en_camino');
    expect(detalle.body.unidad).toMatchObject({ etiqueta: 'Patrulla 12', etaMinutos: 5, lat: 20.54 });

    await new Promise((r) => setTimeout(r, 100));
    expect(actualizaciones.map((a) => a.estado)).toContain('en_camino');
    socket.close();

    expect((await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 4, tipo: 'incidente.estado', datos: { estado: 'en_sitio' } })).status).toBe(202);
    expect((await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 5, tipo: 'incidente.estado', datos: { estado: 'cerrado', nota: 'Atendido' } })).status).toBe(202);
    const cerrado = await http.get(`/v1/reportes/${folio}`).set(auth);
    expect(cerrado.body.historial.map((h: { estado: string }) => h.estado)).toEqual(['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado']);
  });

  it('rechaza firmas inválidas y folios de otra jurisdicción', async () => {
    const token = await registrar('+524423333333');
    const creado = await http.post('/v1/reportes').set({ authorization: `Bearer ${token}` }).send({ incidenteId: 'incendio', ubicacion: { lat: 20.5888, lng: -100.3899 } });
    const folio = creado.body.folio;
    expect(folio).toMatch(/^QRO-014-/);
    expect((await eventoCad('cad-queretaro', 'secreto-equivocado', { folio, secuencia: 1, tipo: 'incidente.recibido', datos: { folioCad: 'X' } })).status).toBe(401);
    expect((await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 1, tipo: 'incidente.recibido', datos: { folioCad: 'X' } })).status).toBe(403);
  });

  it('es idempotente ante eventos repetidos', async () => {
    const token = await registrar('+524424444444');
    const folio = (await http.post('/v1/reportes').set({ authorization: `Bearer ${token}` }).send({ incidenteId: 'agresion', ubicacion: { lat: 20.539, lng: -100.442 } })).body.folio;
    const cuerpo = JSON.stringify({ eventoId: randomUUID(), ocurridoEn: new Date().toISOString(), folio, secuencia: 1, tipo: 'mensaje.operador', datos: { texto: 'Vamos en camino', autor: 'Operador 3' } });
    const enviar = () => { const ts = Math.floor(Date.now() / 1000); return http.post('/v1/cad/cad-corregidora/eventos').set('content-type', 'application/json').set('x-poliaq-timestamp', String(ts)).set('x-poliaq-firma', firmar(SECRETO_CORR, ts, cuerpo)).send(cuerpo); };
    expect((await enviar()).body).toEqual({ aceptado: true });
    expect((await enviar()).body).toEqual({ aceptado: true, duplicado: true });
    const r = await http.get(`/v1/reportes/${folio}`).set({ authorization: `Bearer ${token}` });
    expect(r.body.mensajes).toHaveLength(1);
  });
});

describe('evidencia y cadena de custodia', () => {
  it('acepta el archivo si el hash coincide y lo entrega al CAD con enlace firmado', async () => {
    const token = await registrar('+524425555555');
    const auth = { authorization: `Bearer ${token}` };
    const folio = (await http.post('/v1/reportes').set(auth).send({ incidenteId: 'accidente-vial', ubicacion: { lat: 20.61, lng: -100.32 } })).body.folio;
    expect(folio).toMatch(/^QRO-011-/);

    const archivo = Buffer.from('foto-de-prueba');
    const sha256 = createHash('sha256').update(archivo).digest('hex');
    const sol = await http.post(`/v1/reportes/${folio}/evidencias`).set(auth).send({ tipo: 'foto', mimeType: 'image/jpeg', bytes: archivo.length, sha256, capturadoEn: new Date().toISOString() });
    expect(sol.status).toBe(201);
    const ruta = new URL(sol.body.subirA).pathname;
    const sub = await http.put(ruta).set(auth).set('content-type', 'image/jpeg').send(archivo);
    expect(sub.body).toMatchObject({ estado: 'verificada', sha256 });

    const aviso = app.get(DespachadorCadService).bandeja.find((e) => e.evento.folio === folio && e.evento.tipo === 'incidente.actualizado');
    const enlace = (aviso!.evento.datos as { nuevaEvidencia: { url: string }[] }).nuevaEvidencia[0].url;
    const descarga = await http.get(new URL(enlace).pathname + new URL(enlace).search).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(descarga.status).toBe(200);
    expect(Buffer.compare(descarga.body as Buffer, archivo)).toBe(0);
  });

  it('rechaza un archivo alterado', async () => {
    const token = await registrar('+524426666666');
    const auth = { authorization: `Bearer ${token}` };
    const folio = (await http.post('/v1/reportes').set(auth).send({ incidenteId: 'otro', ubicacion: { lat: 20.539, lng: -100.442 } })).body.folio;
    const sol = await http.post(`/v1/reportes/${folio}/evidencias`).set(auth).send({ tipo: 'audio', mimeType: 'audio/m4a', bytes: 5, sha256: 'a'.repeat(64), capturadoEn: new Date().toISOString() });
    const sub = await http.put(new URL(sol.body.subirA).pathname).set(auth).set('content-type', 'audio/m4a').send(Buffer.from('12345'));
    expect(sub.status).toBe(400);
    expect(sub.body.codigo).toBe('hash_no_coincide');
  });
});

describe('protecciones operativas', () => {
  it('limita reportes por hora', async () => {
    const token = await registrar('+524427777777');
    const auth = { authorization: `Bearer ${token}` };
    const codigos: number[] = [];
    for (let i = 0; i < 6; i++) codigos.push((await http.post('/v1/reportes').set(auth).send({ incidenteId: 'ruido-rina', ubicacion: { lat: 20.5888, lng: -100.3899 } })).status);
    expect(codigos).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('escala al C5 si el CAD municipal no acusa recibo', async () => {
    const token = await registrar('+524428888888');
    const folio = (await http.post('/v1/reportes').set({ authorization: `Bearer ${token}` }).send({ incidenteId: 'fuga-gas', ubicacion: { lat: 20.5888, lng: -100.3899 } })).body.folio;
    await new Promise((r) => setTimeout(r, 600));
    const bandeja = app.get(DespachadorCadService).bandeja.filter((e) => e.evento.folio === folio && e.evento.tipo === 'incidente.creado');
    expect(bandeja.map((e) => e.cadId)).toEqual(['cad-queretaro', 'c5-queretaro']);
    // El folio no cambia aunque el incidente pase al C5.
    expect(bandeja[1].evento.folio).toBe(folio);
  });
});
