import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION, firmar } from '@pol-iaq/shared';
import { crearApp } from '../src/main';
import { cargarConfig, hashClave } from '../src/config';
import { emitirSesion } from '../src/auth/tokens';
import { DespachadorCadService } from '../src/cad/despachador.service';
import type { Almacen } from '../src/almacen/almacen';
import { AlmacenMemoria } from '../src/almacen/almacen-memoria';
import { AlmacenPostgres } from '../src/almacen/almacen-postgres';
import { SmsSimulado } from '../src/sms/sms';
import { Pool } from 'pg';

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

/** URL de una base de PostgreSQL + PostGIS desechable. Sin ella, solo corren las pruebas en memoria. */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Borra todo y deja la base vacía; el almacén la migra al conectar. */
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
if (!TEST_DATABASE_URL) console.warn('TEST_DATABASE_URL no definida: se omiten las pruebas contra PostgreSQL');

describe.each(ALMACENES)('API con almacén en %s', (_nombre, nuevoAlmacen) => {
  let almacen: Almacen;
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

  let sms: SmsSimulado;

  beforeAll(async () => {
    almacen = await nuevoAlmacen();
    sms = new SmsSimulado();
    app = await crearApp(config, { almacen, sms });
    await app.listen(0);
    url = await app.getUrl();
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    await app?.close();
    await almacen?.cerrar();
  });

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

  describe('escenarios y despachadora 911 virtual', () => {
    it('guarda lugares y escenarios en el perfil y valida referencias', async () => {
      const token = await registrar('+524421212121');
      const auth = { authorization: `Bearer ${token}` };
      expect((await http.get('/v1/perfil').set(auth)).body).toEqual({ lugares: [], escenarios: [] });
      const lugar = { id: 'abuelos', nombre: 'Casa de mis abuelos', tipo: 'familiar', ubicacion: { lat: 20.5888, lng: -100.3899, referencia: 'Calle 5 de Mayo 10' }, vulnerables: ['adulto_mayor'], infoMedica: 'Abuelo diabético' };
      const escenario = { id: 'abuelos-medica', lugarId: 'abuelos', titulo: 'Emergencia médica de mis abuelos', incidenteId: 'emergencia-medica', respuestasPrevias: { quien_afectado: 'otra_persona', padecimientos: 'Abuelo diabético' } };
      expect((await http.put('/v1/perfil').set(auth).send({ lugares: [lugar], escenarios: [escenario] })).status).toBe(200);
      expect((await http.get('/v1/perfil').set(auth)).body.escenarios[0].id).toBe('abuelos-medica');
      const malo = await http.put('/v1/perfil').set(auth).send({ lugares: [], escenarios: [escenario] });
      expect(malo.status).toBe(400);
    });

    it('levanta el reporte desde un escenario, guarda el cuestionario en texto y canaliza la unidad', async () => {
      const token = await registrar('+524421313131');
      const auth = { authorization: `Bearer ${token}` };
      const lugar = { id: 'casa', nombre: 'Mi casa', tipo: 'casa', ubicacion: { lat: 20.539, lng: -100.442 }, vulnerables: [] };
      const escenario = { id: 'casa-ruidos', lugarId: 'casa', titulo: 'Ruidos extraños de noche', incidenteId: 'intrusion-domicilio', respuestasPrevias: { dentro_casa: true } };
      await http.put('/v1/perfil').set(auth).send({ lugares: [lugar], escenarios: [escenario] });

      const creado = await http.post('/v1/reportes').set(auth).send({
        incidenteId: 'intrusion-domicilio', escenarioId: 'casa-ruidos', ubicacion: { lat: 20.539, lng: -100.442, referencia: 'Lugar guardado: Mi casa' },
        cuestionario: { via: 'voz', entradas: [{ preguntaId: 'lugar_seguro', respuesta: true, textoOriginal: 'sí, estoy en mi cuarto' }] },
      });
      expect(creado.status).toBe(201);
      const folio = creado.body.folio;
      expect(creado.body.escenarioId).toBe('casa-ruidos');
      expect(creado.body.cuestionario.entradas.map((e: { preguntaId: string }) => e.preguntaId)).toEqual(['dentro_casa', 'lugar_seguro']);
      expect(creado.body.cuestionario.pendientes).toContain('resguardo');
      expect(creado.body.cuestionario.protocoloEstado).toBe('provisional');
      expect(creado.body.recomendaciones.length).toBeGreaterThan(0);

      const bandeja = app.get(DespachadorCadService).bandeja;
      const alta = bandeja.find((e) => e.evento.folio === folio && e.evento.tipo === 'incidente.creado')!.evento.datos as Record<string, any>;
      expect(alta.escenario).toEqual({ id: 'casa-ruidos', titulo: 'Ruidos extraños de noche' });
      expect(alta.cuestionario.transcripcion).toContain('P: ¿Usted y su familia están dentro del domicilio?\nR: Sí [escenario]');
      expect(alta.canalizacion.corporaciones).toEqual(['policia_municipal']);

      const resp = await http.post(`/v1/reportes/${folio}/cuestionario`).set(auth).send({ via: 'texto', entradas: [{ preguntaId: 'intruso_visto', respuesta: true }, { preguntaId: 'armas', respuesta: true }, { preguntaId: 'inventada', respuesta: true }] });
      expect(resp.status).toBe(201);
      expect(resp.body.canalizacion.alertas).toEqual(expect.arrayContaining(['Persona ajena vista en el domicilio', 'Posible persona armada']));
      expect(resp.body.cuestionario.pendientes).not.toContain('armas');
      const act = bandeja.filter((e) => e.evento.folio === folio && e.evento.tipo === 'incidente.actualizado').at(-1)!.evento.datos as Record<string, any>;
      expect(act.cuestionario.entradas).toHaveLength(4);
      expect(act.canalizacion.prioridad).toBe('alta');

      expect((await http.post(`/v1/reportes/${folio}/cuestionario`).set(auth).send({ entradas: [{ preguntaId: 'inventada', respuesta: 1 }] })).status).toBe(400);
      expect((await http.post('/v1/reportes').set(auth).send({ incidenteId: 'otro', escenarioId: 'no-existe', ubicacion: { lat: 20.539, lng: -100.442 } })).status).toBe(400);
    });

    it('el botón de asistencia directa sube la prioridad y suma apoyo médico si hay heridos', async () => {
      const token = await registrar('+524421414141');
      const auth = { authorization: `Bearer ${token}` };
      const r = await http.post('/v1/reportes').set(auth).send({ incidenteId: 'ruido-rina', asistenciaDirecta: true, ubicacion: { lat: 20.5888, lng: -100.3899 } });
      expect(r.body.asistenciaDirecta).toBe(true);
      expect(r.body.canalizacion.prioridad).toBe('alta');
      const otro = await http.post('/v1/reportes').set(auth).send({ incidenteId: 'robo-en-curso', ubicacion: { lat: 20.5888, lng: -100.3899 }, cuestionario: { entradas: [{ preguntaId: 'heridos', respuesta: true }] } });
      expect(otro.body.canalizacion.corporaciones).toEqual(['policia_municipal', 'cruz_roja']);
    });

    it('publica el protocolo vigente', async () => {
      const p = await http.get('/v1/protocolo');
      expect(p.body.estado).toBe('provisional');
      expect(p.body.incidentes.length).toBeGreaterThan(10);
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
  describe('persistencia, concurrencia y avisos por SMS', () => {
    it('no pierde cambios simultáneos sobre el mismo folio', async () => {
      const token = await registrar('+524429990001');
      const auth = { authorization: `Bearer ${token}` };
      const folio = (await http.post('/v1/reportes').set(auth).send({ incidenteId: 'otro', ubicacion: { lat: 20.539, lng: -100.442 } })).body.folio;
      const respuestas = await Promise.all(Array.from({ length: 8 }, (_, i) => http.post(`/v1/reportes/${folio}/mensajes`).set(auth).send({ texto: `mensaje ${i}` })));
      expect(respuestas.every((r) => r.status === 201)).toBe(true);
      const r = await http.get(`/v1/reportes/${folio}`).set(auth);
      expect(r.body.mensajes).toHaveLength(8);
      // Cada aviso al CAD lleva una secuencia distinta y consecutiva.
      const secuencias = app.get(DespachadorCadService).bandeja.filter((e) => e.evento.folio === folio).map((e) => e.evento.secuencia).sort((a, b) => a - b);
      expect(secuencias).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('da folios distintos a reportes simultáneos', async () => {
      const tokens = await Promise.all([1, 2, 3, 4, 5].map((i) => registrar(`+52442999100${i}`)));
      const folios = await Promise.all(tokens.map(async (t) => (await http.post('/v1/reportes').set({ authorization: `Bearer ${t}` }).send({ incidenteId: 'otro', ubicacion: { lat: 20.61, lng: -100.32 } })).body.folio as string));
      expect(new Set(folios).size).toBe(5);
    });

    it('avisa por SMS cuando se asigna la unidad', async () => {
      const telefono = '+524429990002';
      const token = await registrar(telefono);
      const folio = (await http.post('/v1/reportes').set({ authorization: `Bearer ${token}` }).send({ incidenteId: 'agresion', ubicacion: { lat: 20.539, lng: -100.442 } })).body.folio;
      await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 1, tipo: 'unidad.asignada', datos: { unidadId: 'P-7', corporacion: 'policia_municipal', etiqueta: 'Patrulla 7', etaMinutos: 4 } });
      await new Promise((r) => setTimeout(r, 100));
      const aviso = sms.enviados.find((m) => m.telefono === telefono);
      expect(aviso?.texto).toContain(folio);
      expect(aviso?.texto).toContain('Patrulla 7');
    });

    it('conserva el reporte, la unidad y su posición al reiniciar el API', async () => {
      const token = await registrar('+524429990003');
      const auth = { authorization: `Bearer ${token}` };
      const folio = (await http.post('/v1/reportes').set(auth).send({ incidenteId: 'robo-en-curso', ubicacion: { lat: 20.539, lng: -100.442, precisionMetros: 12, referencia: 'Frente a la farmacia' } })).body.folio;
      await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 1, tipo: 'unidad.asignada', datos: { unidadId: 'P-3', corporacion: 'policia_municipal', etiqueta: 'Patrulla 3', etaMinutos: 6 } });
      await eventoCad('cad-corregidora', SECRETO_CORR, { folio, secuencia: 2, tipo: 'unidad.posicion', datos: { unidadId: 'P-3', lat: 20.5412, lng: -100.4401, rumbo: 180, etaMinutos: 3 } });
      const antes = (await http.get(`/v1/reportes/${folio}`).set(auth)).body;

      // Otra instancia del API sobre el mismo almacén ve exactamente lo mismo.
      const otra = await crearApp(config, { almacen, sms });
      await otra.init();
      const despues = (await request(otra.getHttpServer()).get(`/v1/reportes/${folio}`).set(auth)).body;
      await otra.close();
      expect(despues).toEqual(antes);
      expect(despues.unidad).toMatchObject({ etiqueta: 'Patrulla 3', lat: 20.5412, lng: -100.4401, rumbo: 180, etaMinutos: 3 });
      expect(despues.ubicacion).toEqual({ lat: 20.539, lng: -100.442, precisionMetros: 12, referencia: 'Frente a la farmacia' });
      expect((await almacen.auditoria(folio)).map((a) => a.accion)).toEqual(['reporte_creado', 'unidad.asignada', 'unidad.posicion']);
    });
  });

  describe('consola del operador', () => {
    let appOp: INestApplication;
    let httpOp: ReturnType<typeof request>;
    let urlOp: string;

    beforeAll(async () => {
      // El Marqués despacha desde la consola; Corregidora tiene CAD propio (webhook).
      appOp = await crearApp({
        ...config,
        esperaAcuseSeg: 60,
        cads: { ...config.cads, 'cad-el-marques': { ...config.cads['cad-el-marques'], modo: 'consola' } },
        operadores: [
          { usuario: 'ana', nombre: 'Ana · CAD El Marqués', cadIds: ['cad-el-marques'], claveHash: hashClave('clave-de-ana-123') },
          { usuario: 'sup', nombre: 'Supervisión', cadIds: ['*'], claveHash: hashClave('clave-de-sup-123') },
        ],
      }, { almacen, sms });
      await appOp.listen(0);
      urlOp = await appOp.getUrl();
      httpOp = request(appOp.getHttpServer());
    });
    afterAll(async () => appOp?.close());

    async function entrar(usuario: string, clave: string) {
      const res = await httpOp.post('/v1/operador/sesion').send({ usuario, clave });
      expect(res.status).toBe(200);
      return { authorization: `Bearer ${res.body.token as string}` };
    }
    const crear = async (token: string, lat: number, lng: number, extra: Record<string, unknown> = {}) =>
      (await httpOp.post('/v1/reportes').set({ authorization: `Bearer ${token}` }).send({ incidenteId: 'emergencia-medica', ubicacion: { lat, lng }, ...extra })).body.folio as string;
    const accion = (auth: Record<string, string>, folio: string, body: object) => httpOp.post(`/v1/operador/reportes/${folio}/acciones`).set(auth).send(body);

    it('autentica operadores y no mezcla sus tokens con los del ciudadano', async () => {
      expect((await httpOp.post('/v1/operador/sesion').send({ usuario: 'ana', clave: 'mala' })).status).toBe(401);
      expect((await httpOp.post('/v1/operador/sesion').send({ usuario: 'nadie', clave: 'x' })).status).toBe(401);
      const op = await entrar('ana', 'clave-de-ana-123');
      const yo = await httpOp.get('/v1/operador/yo').set(op);
      expect(yo.body.operador).toMatchObject({ usuario: 'ana', cads: ['cad-el-marques'] });
      expect(yo.body.cads.find((c: { id: string }) => c.id === 'cad-el-marques')).toMatchObject({ modo: 'consola', mio: true });

      const ciudadano = await registrar('+524427770001');
      expect((await httpOp.get('/v1/operador/reportes').set({ authorization: `Bearer ${ciudadano}` })).status).toBe(401);
      expect((await httpOp.get('/v1/reportes').set(op)).status).toBe(401);
    });

    it('bloquea la cuenta tras 5 claves incorrectas', async () => {
      for (let i = 0; i < 5; i++) await httpOp.post('/v1/operador/sesion').send({ usuario: 'sup', clave: 'mala' });
      expect((await httpOp.post('/v1/operador/sesion').send({ usuario: 'sup', clave: 'clave-de-sup-123' })).status).toBe(429);
    });

    it('despacha desde la consola y el ciudadano lo ve en tiempo real', async () => {
      const token = await registrar('+524427770002');
      const folio = await crear(token, 20.61, -100.32, { cuestionario: { entradas: [{ preguntaId: 'consciente', respuesta: false }] } });
      const op = await entrar('ana', 'clave-de-ana-123');

      const socketOp = ioClient(`${urlOp}/operacion`, { transports: ['websocket'] });
      expect((await socketOp.emitWithAck('suscribir', { token: 'falso' })).ok).toBe(false);
      expect((await socketOp.emitWithAck('suscribir', { token: op.authorization.slice(7) })).ok).toBe(true);
      const enConsola: { folio: string; estado: string }[] = [];
      socketOp.on('reporte.actualizado', (v) => enConsola.push(v));
      const socketCiu = ioClient(`${urlOp}/seguimiento`, { transports: ['websocket'] });
      expect((await socketCiu.emitWithAck('suscribir', { token, folio })).ok).toBe(true);
      const enApp: { estado: string; mensajes: { texto: string }[] }[] = [];
      socketCiu.on('reporte.actualizado', (r) => enApp.push(r));

      const bandeja = await httpOp.get('/v1/operador/reportes').set(op);
      const v = bandeja.body.reportes.find((x: { folio: string }) => x.folio === folio);
      expect(v).toMatchObject({ cadId: 'cad-el-marques', operable: true, prioridad: 'alta', reportante: { telefono: '+524427770002' } });
      expect(v.cuestionario.transcripcion).toContain('PROVISIONAL');
      expect(v.escalaAlC5En).toBeTruthy();
      expect(app.get(DespachadorCadService).bandeja.some((e) => e.evento.folio === folio)).toBe(false);
      expect(appOp.get(DespachadorCadService).bandeja.find((e) => e.evento.folio === folio)?.estado).toBe('consola');

      expect((await accion(op, folio, { accion: 'recibir' })).body).toMatchObject({ estado: 'validado', folioCad: folio, escalaAlC5En: null });
      expect((await accion(op, folio, { accion: 'recibir' })).status).toBe(409);
      expect((await accion(op, folio, { accion: 'asignar', unidadId: 'P-101' })).status).toBe(400);
      const unidades = (await httpOp.get('/v1/operador/unidades').set(op)).body.unidades as { unidadId: string; cadId: string; ocupadaEn: string | null }[];
      expect(new Set(unidades.map((u) => u.cadId))).toEqual(new Set(['cad-el-marques']));
      const amb = unidades.find((u) => u.unidadId.startsWith('A-'))!;
      expect((await accion(op, folio, { accion: 'asignar', unidadId: amb.unidadId, etaMinutos: 6 })).body).toMatchObject({ estado: 'asignado', unidad: { unidadId: amb.unidadId, etaMinutos: 6 } });
      expect((await httpOp.get('/v1/operador/unidades').set(op)).body.unidades.find((u: { unidadId: string }) => u.unidadId === amb.unidadId).ocupadaEn).toBe(folio);
      expect((await accion(op, folio, { accion: 'mensaje', texto: 'La ambulancia va en camino, no lo mueva.' })).status).toBe(200);
      for (const estado of ['en_camino', 'en_sitio', 'cerrado']) expect((await accion(op, folio, { accion: 'estado', estado })).body.estado).toBe(estado);
      expect((await accion(op, folio, { accion: 'mensaje', texto: 'otro' })).body.codigo).toBe('reporte_cerrado');

      await new Promise((r) => setTimeout(r, 150));
      expect(enConsola.filter((x) => x.folio === folio).map((x) => x.estado)).toEqual(expect.arrayContaining(['validado', 'asignado', 'cerrado']));
      expect(enApp.at(-1)?.estado).toBe('cerrado');
      expect(enApp.flatMap((r) => r.mensajes.map((m) => m.texto))).toContain('La ambulancia va en camino, no lo mueva.');
      socketOp.close();
      socketCiu.close();

      const ciudadano = (await httpOp.get(`/v1/reportes/${folio}`).set({ authorization: `Bearer ${token}` })).body;
      expect(ciudadano.historial.map((h: { estado: string }) => h.estado)).toEqual(['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado']);
      expect(ciudadano.unidad.etiqueta).toBe(amb.unidadId.replace('A-', 'Ambulancia '));
      const audit = await almacen.auditoria(folio);
      expect(audit.filter((a) => a.actor === 'operador:ana').map((a) => a.accion)).toEqual(expect.arrayContaining(['incidente.recibido', 'unidad.asignada', 'mensaje.operador']));
      expect((await httpOp.get('/v1/operador/reportes').set(op)).body.reportes.some((x: { folio: string }) => x.folio === folio)).toBe(false);
      expect((await httpOp.get('/v1/operador/reportes?todos=1').set(op)).body.reportes.some((x: { folio: string }) => x.folio === folio)).toBe(true);
    });

    it('limita al operador a sus CAD y deja en solo lectura los CAD con sistema propio', async () => {
      const token = await registrar('+524427770003');
      const deCorregidora = await crear(token, 20.539, -100.442);
      const ana = await entrar('ana', 'clave-de-ana-123');
      expect((await httpOp.get(`/v1/operador/reportes/${deCorregidora}`).set(ana)).status).toBe(404);
      expect((await accion(ana, deCorregidora, { accion: 'recibir' })).status).toBe(404);

      // Con OPERADORES_JSON no existe el usuario de desarrollo.
      expect((await httpOp.post('/v1/operador/sesion').send({ usuario: 'operador', clave: 'operador' })).status).toBe(401);
      // `sup` quedó bloqueado en la prueba anterior: se usa un token emitido directamente.
      const supToken = { authorization: `Bearer ${emitirSesion(config.secretoTokens, { sub: 'sup', rol: 'operador', nombre: 'Supervisión', cads: ['*'] }, 60)}` };
      const vista = await httpOp.get(`/v1/operador/reportes/${deCorregidora}`).set(supToken);
      expect(vista.body).toMatchObject({ cadId: 'cad-corregidora', operable: false, transiciones: [] });
      expect((await accion(supToken, deCorregidora, { accion: 'recibir' })).body.codigo).toBe('cad_con_sistema_propio');
    });

    it('transfiere al C5 y saca el reporte de la bandeja del CAD de origen', async () => {
      const token = await registrar('+524427770004');
      const folio = await crear(token, 20.61, -100.32);
      const ana = await entrar('ana', 'clave-de-ana-123');
      expect((await accion(ana, folio, { accion: 'transferir', cadDestinoId: 'cad-el-marques' })).status).toBe(400);
      const t = await accion(ana, folio, { accion: 'transferir', cadDestinoId: 'c5-queretaro', motivo: 'Rebasa capacidad municipal' });
      expect(t.body).toMatchObject({ cadId: 'c5-queretaro', estado: 'transferido', operable: false });
      // El C5 tiene sistema propio: recibe el alta por webhook.
      const alta = appOp.get(DespachadorCadService).bandeja.find((e) => e.evento.folio === folio && e.cadId === 'c5-queretaro');
      expect(alta?.evento.tipo).toBe('incidente.creado');
      expect((await httpOp.get(`/v1/operador/reportes/${folio}`).set(ana)).status).toBe(404);
    });
  });

  describe('código de verificación por SMS', () => {
    let appOtp: INestApplication;
    let smsOtp: SmsSimulado;
    let httpOtp: ReturnType<typeof request>;

    beforeAll(async () => {
      smsOtp = new SmsSimulado();
      // Sin código fijo de desarrollo: se comporta como en producción.
      appOtp = await crearApp({ ...config, otpDesarrollo: '' }, { almacen, sms: smsOtp });
      await appOtp.init();
      httpOtp = request(appOtp.getHttpServer());
    });
    afterAll(async () => appOtp?.close());

    const verificar = (telefono: string, codigo: string) =>
      httpOtp.post('/v1/auth/verificar').send({ telefono, codigo, nombre: 'Prueba OTP', aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION });
    const ultimoCodigo = (telefono: string) => smsOtp.enviados.filter((m) => m.telefono === telefono).at(-1)!.texto.match(/\b(\d{6})\b/)![1];

    it('envía el código por SMS, lo acepta una sola vez y rechaza el fijo de desarrollo', async () => {
      const telefono = '+524429990010';
      expect((await httpOtp.post('/v1/auth/otp').send({ telefono })).status).toBe(202);
      const codigo = ultimoCodigo(telefono);
      expect((await verificar(telefono, codigo === '000000' ? '111111' : '000000')).status).toBe(401);
      expect((await verificar(telefono, codigo)).status).toBe(201);
      expect((await verificar(telefono, codigo)).status).toBe(401);
    });

    it('bloquea el código tras 5 intentos fallidos', async () => {
      const telefono = '+524429990011';
      await httpOtp.post('/v1/auth/otp').send({ telefono });
      const codigo = ultimoCodigo(telefono);
      const malo = codigo === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i++) expect((await verificar(telefono, malo)).status).toBe(401);
      expect((await verificar(telefono, codigo)).status).toBe(401);
    });

    it('limita a 3 códigos por número cada 15 minutos', async () => {
      const telefono = '+524429990012';
      const codigos: number[] = [];
      for (let i = 0; i < 4; i++) codigos.push((await httpOtp.post('/v1/auth/otp').send({ telefono })).status);
      expect(codigos).toEqual([202, 202, 202, 429]);
    });
  });
});
