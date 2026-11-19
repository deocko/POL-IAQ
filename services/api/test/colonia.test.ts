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

describe('Colonia del folio: catálogo SEPOMEX, alta manual y corrección desde la consola', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let sup: Record<string, string>;
  let qro: Record<string, string>;
  const qroPunto = puntoEn('22014');

  const entrar = async (usuario: string, clave: string) => ({ authorization: `Bearer ${(await http.post('/v1/operador/sesion').send({ usuario, clave })).body.token as string}` });
  const alta = (auth: Record<string, string>, extra: object) => http.post('/v1/operador/reportes/911').set(auth).send({ telefono: '4425551234', nombre: 'Lola Calle', tipoTelefono: 'celular', incidenteId: 'robo-en-curso', ubicacion: qroPunto, ...extra });

  beforeAll(async () => {
    app = await crearApp(config, { almacen: new AlmacenMemoria(), sms: new SmsSimulado() });
    await app.listen(0);
    http = request(app.getHttpServer());
    sup = await entrar('sup', 'clave-sup-123');
    qro = await entrar('qro', 'clave-qro-123');
  });
  afterAll(async () => { await app?.close(); });

  it('alta 911 con una colonia del catálogo: queda en el folio, validada', async () => {
    const r = await alta(qro, { colonia: { coloniaId: '76000-centro' } });
    expect(r.status).toBe(201);
    expect(r.body.reporte.colonia).toMatchObject({ id: '76000-centro', nombre: 'Centro', cp: '76000', fuente: 'sepomex', validada: true, metodo: 'operador', asignadaPor: 'operador:qro' });
  });

  it('una colonia de otro municipio o desconocida se rechaza con un mensaje claro', async () => {
    const otra = await alta(qro, { colonia: { coloniaId: (await import('@pol-iaq/shared')).coloniasPorCp('76900', ['22006'])[0]?.id ?? '76900-x' } });
    expect(otra.status).toBe(400);
    expect(['colonia_otro_municipio', 'colonia_desconocida']).toContain(otra.body.codigo);
    expect((await alta(qro, { colonia: { coloniaId: 'no-existe-123' } })).body.codigo).toBe('colonia_desconocida');
  });

  it('alta manual: guarda CP y coordenadas y queda marcada «manual» por validar', async () => {
    const r = await alta(qro, { colonia: { manual: { nombre: 'Privada Las Nubes', cp: '76090', lat: qroPunto.lat, lng: qroPunto.lng } } });
    expect(r.status).toBe(201);
    expect(r.body.reporte.colonia).toMatchObject({ id: null, nombre: 'Privada Las Nubes', cp: '76090', fuente: 'manual', validada: false, lat: qroPunto.lat, lng: qroPunto.lng });
    expect((await alta(qro, { colonia: { manual: { nombre: 'Fuera', cp: '76090', lat: 19.43, lng: -99.13 } } })).body.codigo).toBe('ubicacion_fuera');
    expect((await alta(qro, { colonia: { manual: { nombre: 'CP malo', cp: '01000', lat: qroPunto.lat, lng: qroPunto.lng } } })).status).toBe(400);
  });

  it('sin colonia elegida: se deriva solo de una mención explícita en la referencia; si no, sin colonia', async () => {
    const con = await alta(qro, { ubicacion: { ...qroPunto, referencia: 'Calle 5 de Mayo, Col. Centro' } });
    expect(con.body.reporte.colonia).toMatchObject({ id: '76000-centro', metodo: 'referencia' });
    const sin = await alta(qro, { ubicacion: { ...qroPunto, referencia: 'Frente al parque' } });
    expect(sin.body.reporte.colonia).toBeNull();
    // Los folios de la app también entran sin colonia si la ubicación no la menciona.
    const c = await http.post('/v1/auth/verificar').send({ telefono: '+524425559999', codigo: '000000', nombre: 'Ana App', aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION });
    const app1 = await http.post('/v1/reportes').set({ authorization: `Bearer ${c.body.token as string}` }).send({ incidenteId: 'incendio', ubicacion: qroPunto });
    expect(app1.status).toBe(201);
    const vista = (await http.get(`/v1/operador/reportes/${app1.body.folio}`).set(qro)).body;
    expect(vista.colonia).toBeNull();
  });

  it('el operador asigna y corrige la colonia: queda en el historial de correcciones', async () => {
    const r = (await alta(qro, {})).body.reporte;
    const a = await http.post(`/v1/operador/reportes/${r.folio}/colonia`).set(qro).send({ colonia: { coloniaId: '76000-la-cruz' } });
    expect(a.status).toBe(200);
    expect(a.body.colonia).toMatchObject({ id: '76000-la-cruz', nombre: 'La Cruz' });
    expect(a.body.coloniaCorrecciones).toEqual([expect.objectContaining({ de: null, a: 'La Cruz · CP 76000', actor: 'operador:qro' })]);
    const b = await http.post(`/v1/operador/reportes/${r.folio}/colonia`).set(qro).send({ colonia: { coloniaId: '76000-centro' }, motivo: 'El reportante confirmó la colonia' });
    expect(b.body.coloniaCorrecciones.at(-1)).toMatchObject({ de: 'La Cruz · CP 76000', a: 'Centro · CP 76000', motivo: 'El reportante confirmó la colonia' });
    expect((await http.post(`/v1/operador/reportes/${r.folio}/colonia`).set(qro).send({ colonia: { coloniaId: '76000-centro' } })).body.codigo).toBe('misma_colonia');
  });

  it('un operador municipal no puede ver ni tocar folios de otro municipio', async () => {
    const otro = (await alta(sup, { ubicacion: puntoEn('22006') })).body.reporte;
    expect(otro.municipioClave).toBe('22006');
    const lista = (await http.get('/v1/operador/reportes?todos=1').set(qro)).body.reportes as { municipioClave: string }[];
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((x) => x.municipioClave === '22014')).toBe(true);
    expect((await http.post(`/v1/operador/reportes/${otro.folio}/colonia`).set(qro).send({ colonia: { coloniaId: '76000-centro' } })).status).toBe(404);
  });
});
