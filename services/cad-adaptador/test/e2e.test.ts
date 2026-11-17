/**
 * Punta a punta: POL-IAQ (API real, en memoria) ⇄ adaptador de referencia ⇄ CAD simulado en
 * formato nativo. Reporte → acuse → asignación → GPS → cierre, y la suite de los 8 casos.
 * Solo datos de demostración.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { AVISO_PRIVACIDAD_VERSION, CASOS_PRUEBA_CAD, TERMINOS_VERSION, municipioPorClave, puntoInterior } from '@pol-iaq/shared';
import { crearApp } from '../../api/src/main';
import { cargarConfig as configApi, hashClave } from '../../api/src/config';
import { AlmacenMemoria } from '../../api/src/almacen/almacen-memoria';
import { SmsSimulado } from '../../api/src/sms/sms';
import { crearSimulador, type Simulador } from '../../cad-simulator/src/simulador';
import { crearAdaptador, eventoIdDe, type Adaptador } from '../src/adaptador';
import { cargarConfig } from '../src/config';
import { certificar } from '../src/certificacion';

const CAD = 'cad-san-juan-del-rio';
const SECRETO = 'secreto-de-pruebas-sjr-0123456789abcdef';
const UNIDADES = [
  { unidadId: 'SJR-A1', corporacion: 'cruz_roja', etiqueta: 'Ambulancia SJR 1', tipo: 'ambulancia' },
  { unidadId: 'SJR-P1', corporacion: 'policia_municipal', etiqueta: 'Patrulla SJR 1', tipo: 'patrulla' },
];
const silencio = () => undefined;

describe('adaptador de referencia de punta a punta con el CAD simulado (formato nativo)', () => {
  let api: INestApplication;
  let apiUrl: string;
  let sim: Simulador;
  let adaptador: Adaptador;
  let sup: string;

  async function llamar<T = Record<string, unknown>>(ruta: string, init: { metodo?: string; token?: string; cuerpo?: unknown } = {}) {
    const r = await fetch(`${apiUrl}${ruta}`, { method: init.metodo ?? (init.cuerpo ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(init.token && { authorization: `Bearer ${init.token}` }) }, ...(init.cuerpo !== undefined && { body: JSON.stringify(init.cuerpo) }) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
  }

  beforeAll(async () => {
    api = await crearApp({
      ...configApi({ NODE_ENV: 'test' }),
      esperaAcuseSeg: 10,
      asignacionAutomatica: false,
      cads: { 'cad-queretaro': { modo: 'consola' }, 'c5-queretaro': { modo: 'consola' } },
      operadores: [{ usuario: 'sup', nombre: 'Supervisión C5', cadIds: ['*'], claveHash: hashClave('clave-sup-123') }],
    }, { almacen: new AlmacenMemoria(), sms: new SmsSimulado() });
    await api.listen(0, '127.0.0.1');
    apiUrl = (await api.getUrl()).replace('[::1]', '127.0.0.1');

    sim = crearSimulador({ modo: 'nativo', pasoMs: 120, cadId: CAD, tokenHaciaAdaptador: 'token-desde-cad', tokenEntrada: 'token-hacia-cad', unidades: UNIDADES, log: silencio });
    await new Promise<void>((r) => sim.servidor.listen(0, '127.0.0.1', () => r()));
    const simUrl = `http://127.0.0.1:${(sim.servidor.address() as AddressInfo).port}`;

    adaptador = crearAdaptador({
      puerto: 0, polIaqUrl: apiUrl, despliegue: 'alojado', reintentosMs: [0, 200, 400, 800], avlCadaMs: 200, tiempoMaxMs: 3000,
      tenants: { [CAD]: { cadId: CAD, secreto: SECRETO, cadUrl: simUrl, tokenHaciaCad: 'token-hacia-cad', tokenDesdeCad: 'token-desde-cad' } },
    }, silencio);
    await new Promise<void>((r) => adaptador.servidor.listen(0, '127.0.0.1', () => r()));
    sim.opciones.adaptadorUrl = adaptador.url();

    sup = (await llamar<{ token: string }>('/v1/operador/sesion', { cuerpo: { usuario: 'sup', clave: 'clave-sup-123' } })).body.token;
    const alta = await llamar(`/v1/admin/cads/${CAD}`, {
      metodo: 'PUT', token: sup,
      cuerpo: { nombre: 'CAD San Juan del Río', clave: '22016', modo: 'webhook', webhookUrl: `${adaptador.url()}/poliaq/${CAD}/eventos`, secreto: SECRETO, ipsPermitidas: ['127.0.0.1', '::1'], contactoTecnico: { nombre: 'Responsable técnico (demo)', correo: 'tecnico@example.com' } },
    });
    expect(alta.status).toBe(200);
    expect(alta.body).toMatchObject({ estado: 'pruebas', conectado: true, clave: '22016' });
    for (const u of UNIDADES) expect((await llamar('/v1/operador/unidades', { token: sup, cuerpo: { ...u, cadId: CAD } })).status).toBe(200);
  });

  afterAll(async () => {
    await adaptador?.cerrar();
    await sim?.cerrar();
    await api?.close();
  });

  it('reporte → acuse → asignación → GPS → cierre, sin datos personales en el adaptador', async () => {
    const tel = '+524429990001';
    const ciudadano = (await llamar<{ token: string }>('/v1/auth/verificar', { cuerpo: { telefono: tel, codigo: '000000', nombre: 'Ciudadana Demo', aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION } })).body.token;
    const punto = puntoInterior(municipioPorClave('22016')!.geocerca)!;
    const r = await llamar<{ folio: string }>('/v1/reportes', { token: ciudadano, cuerpo: { incidenteId: 'emergencia-medica', ubicacion: punto, descripcion: 'Persona desmayada (demostración)' } });
    expect(r.status).toBe(201);
    const folio = r.body.folio;
    expect(folio).toMatch(/^QRO-016-/);

    type Vista = { estado: string; folioCad: string | null; cadId: string; municipioClave: string; unidad: { unidadId: string; lat?: number } | null; historial: { estado: string }[] };
    let v: Vista | null = null;
    for (let i = 0; i < 80 && v?.estado !== 'cerrado'; i++) {
      await new Promise((res) => setTimeout(res, 100));
      v = (await llamar<Vista>(`/v1/reportes/${folio}`, { token: ciudadano })).body;
    }
    expect(v!.historial.map((h) => h.estado)).toEqual(['recibido', 'validado', 'asignado', 'en_camino', 'en_sitio', 'cerrado']);
    const op = (await llamar<Vista>(`/v1/operador/reportes/${folio}`, { token: sup })).body;
    expect(op).toMatchObject({ cadId: CAD, municipioClave: '22016', unidad: { unidadId: 'SJR-A1' } });
    expect(op.folioCad).toMatch(/^CAD-SAN-JUAN-DEL-RIO-/);
    expect(op.unidad!.lat).toBeTypeOf('number');
    // AVL en lote aceptado: la unidad tiene posición en el mapa.
    const unidades = (await llamar<{ unidades: { unidadId: string; posicion: unknown }[] }>('/v1/operador/unidades', { token: sup })).body.unidades;
    expect(unidades.find((u) => u.unidadId === 'SJR-A1')?.posicion).toBeTruthy();

    const estado = JSON.stringify(adaptador.estadoInterno());
    expect(estado).not.toContain(tel);
    expect(estado).not.toContain('Ciudadana');
    expect(estado).not.toContain('desmayada');
    // Al cerrar, olvida el folio.
    expect(adaptador.estadoInterno().secuencias[`${CAD}|${folio}`]).toBeUndefined();
  });

  it('pasa los 8 casos obligatorios y entonces el CAD se puede activar', async () => {
    expect((await llamar(`/v1/admin/cads/${CAD}/estado`, { token: sup, cuerpo: { estado: 'activo' } })).body).toMatchObject({ codigo: 'casos_pendientes' });
    const resultados = await certificar({
      polIaqUrl: apiUrl, cadId: CAD, supervisor: { usuario: 'sup', clave: 'clave-sup-123' }, otp: '000000',
      destinoTransferencia: 'cad-queretaro', esperaAcuseSeg: 10, tiempoMaxSeg: 15, registrar: true, log: process.env.VER_CASOS ? console.log : silencio,
    });
    for (const c of CASOS_PRUEBA_CAD) expect(resultados[c.id], `${c.id}: ${resultados[c.id]?.detalle}`).toMatchObject({ ok: true });
    const activo = await llamar(`/v1/admin/cads/${CAD}/estado`, { token: sup, cuerpo: { estado: 'activo' } });
    expect(activo.body).toMatchObject({ estado: 'activo', casosPendientes: [] });
  });

  it('el CAD que reintenta un evento (mismo idEvento) llega a POL-IAQ con el mismo eventoId', () => {
    expect(eventoIdDe(CAD, 'QRO-016-2026-000001-1')).toBe(eventoIdDe(CAD, 'QRO-016-2026-000001-1'));
    expect(eventoIdDe(CAD, 'QRO-016-2026-000001-1')).not.toBe(eventoIdDe('cad-queretaro', 'QRO-016-2026-000001-1'));
    expect(eventoIdDe(CAD, 'x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('instalado en el municipio: un solo CAD por variables de entorno y rutas sin cadId', async () => {
    expect(() => cargarConfig({ CAD_ID: CAD })).toThrow(/POLIAQ_SECRETO/);
    expect(() => cargarConfig({ ADAPTADOR_TENANTS_JSON: JSON.stringify({ 'cad-inexistente': { secreto: SECRETO, cadUrl: 'http://x', tokenDesdeCad: 't' } }) })).toThrow(/desconocido/);
    const c = cargarConfig({ CAD_ID: CAD, POLIAQ_SECRETO: SECRETO, CAD_URL: 'http://127.0.0.1:9', CAD_TOKEN_ENTRADA: 'tok', POLIAQ_URL: apiUrl, PORT: '0' });
    expect(c).toMatchObject({ despliegue: 'instalado', tenants: { [CAD]: { cadUrl: 'http://127.0.0.1:9' } } });
    const solo = crearAdaptador(c, silencio);
    await new Promise<void>((r) => solo.servidor.listen(0, '127.0.0.1', () => r()));
    try {
      const salud = await (await fetch(`${solo.url()}/salud`)).json();
      expect(salud).toMatchObject({ despliegue: 'instalado', cads: [CAD] });
      // Sin token del CAD, 401; con firma inválida de POL-IAQ, 401.
      expect((await fetch(`${solo.url()}/cad/eventos`, { method: 'POST', body: '{}' })).status).toBe(401);
      expect((await fetch(`${solo.url()}/poliaq/eventos`, { method: 'POST', body: '{}', headers: { 'x-poliaq-timestamp': '1', 'x-poliaq-firma': 'x' } })).status).toBe(401);
      expect((await fetch(`${solo.url()}/cad/eventos`, { method: 'POST', body: '{"tipo":"ACUSE"}', headers: { authorization: 'Bearer tok' } })).status).toBe(400);
    } finally {
      await solo.cerrar();
    }
  });
});
