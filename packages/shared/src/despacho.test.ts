import { describe, expect, it } from 'vitest';
import {
  debeOfrecer911, distanciaMetros, encolar, esQueja, estimarRuta, medirTiempos, permiteAnonimo, reportanteVisible, resumirTiempos,
  rutaConRespaldo, unidadMasCercana, puedeDespachar, etaSuperaMeta, CAD_ESTATAL_ID, vaciarCola, CrearReporteSchema, OpinionSchema,
} from './index';

const centro = { lat: 20.5888, lng: -100.3899 };

describe('despacho por cercanía', () => {
  it('mide distancias razonables', () => {
    // ~1 km al norte
    expect(distanciaMetros(centro, { lat: centro.lat + 0.009, lng: centro.lng })).toBeGreaterThan(990);
    expect(distanciaMetros(centro, { lat: centro.lat + 0.009, lng: centro.lng })).toBeLessThan(1010);
  });

  it('estima la llegada por calles a velocidad de emergencia', () => {
    const r = estimarRuta(centro, { lat: centro.lat + 0.009, lng: centro.lng });
    expect(r.metros).toBeGreaterThan(1350); // × factor de calles
    expect(r.segundos).toBeGreaterThan(130);
    expect(r.segundos).toBeLessThan(160);
    expect(r.fuente).toBe('estimada');
  });

  it('elige la unidad disponible más cercana de la corporación pedida', () => {
    const unidades = [
      { unidadId: 'A', corporacion: 'policia_municipal', etiqueta: 'A', disponible: true, posicion: { lat: centro.lat + 0.03, lng: centro.lng } },
      { unidadId: 'B', corporacion: 'policia_municipal', etiqueta: 'B', disponible: true, posicion: { lat: centro.lat + 0.01, lng: centro.lng } },
      { unidadId: 'C', corporacion: 'policia_municipal', etiqueta: 'C', disponible: false, posicion: centro },
      { unidadId: 'D', corporacion: 'cruz_roja', etiqueta: 'D', disponible: true, posicion: { lat: centro.lat + 0.001, lng: centro.lng } },
      { unidadId: 'E', corporacion: 'policia_municipal', etiqueta: 'E', disponible: true },
    ];
    expect(unidadMasCercana(unidades, centro, 'policia_municipal')?.unidad.unidadId).toBe('B');
    expect(unidadMasCercana(unidades, centro, 'bomberos')?.unidad.unidadId).toBe('D');
    expect(unidadMasCercana(unidades.filter((u) => u.unidadId === 'E'), centro)).toBeNull();
  });

  it('usa la estimación si el servicio de rutas falla', async () => {
    const r = await rutaConRespaldo({ ruta: async () => { throw new Error('sin servicio'); } }, centro, { lat: 20.6, lng: -100.38 });
    expect(r.fuente).toBe('estimada');
  });
});

describe('tiempos de respuesta', () => {
  const t0 = Date.parse('2026-11-14T10:00:00Z');
  const en = (s: number) => new Date(t0 + s * 1000).toISOString();

  it('mide cada etapa contra su meta', () => {
    const m = medirTiempos([
      { estado: 'recibido', en: en(0) },
      { estado: 'validado', en: en(30) },
      { estado: 'asignado', en: en(200) },
      { estado: 'en_camino', en: en(230) },
      { estado: 'en_sitio', en: en(700) },
      { estado: 'cerrado', en: en(900) },
    ], 'alta', t0 + 1000_000);
    expect(m.etapas.map((e) => [e.id, e.segundos, e.estado])).toEqual([
      ['recepcion', 30, 'cumplida'],
      ['asignacion', 170, 'excedida'],
      ['salida', 30, 'cumplida'],
      ['traslado', 470, 'cumplida'],
    ]);
    expect(m.llegada).toMatchObject({ segundos: 700, estado: 'cumplida' });
  });

  it('marca la etapa en curso y en riesgo', () => {
    const m = medirTiempos([{ estado: 'recibido', en: en(0) }], 'alta', t0 + 50_000);
    expect(m.etapas[0]).toMatchObject({ estado: 'en_riesgo', segundos: 50 });
    expect(m.etapas[1].estado).toBe('pendiente');
  });

  it('resume el tablero', () => {
    const a = medirTiempos([{ estado: 'recibido', en: en(0) }, { estado: 'validado', en: en(20) }], 'alta', t0 + 30_000);
    const b = medirTiempos([{ estado: 'recibido', en: en(0) }, { estado: 'validado', en: en(100) }], 'alta', t0 + 200_000);
    const r = resumirTiempos([a, b]);
    expect(r[0]).toMatchObject({ id: 'recepcion', n: 2, promedioSegundos: 60, medianaSegundos: 60, enMeta: 50 });
  });

  it('un traslado de 0 s (en camino y en sitio a la vez) no cuenta y no baja la mediana a 0', () => {
    const conTraslado = (s: number) => medirTiempos([
      { estado: 'recibido', en: en(0) }, { estado: 'validado', en: en(10) }, { estado: 'asignado', en: en(10) },
      { estado: 'en_camino', en: en(20) }, { estado: 'en_sitio', en: en(20 + s) },
    ], 'alta', t0 + 1000_000);
    const cero = conTraslado(0);
    expect(cero.etapas[3]).toMatchObject({ segundos: null, estado: 'omitida' });
    const r = resumirTiempos([cero, cero, conTraslado(80), conTraslado(100)]);
    expect(r[3]).toMatchObject({ id: 'traslado', n: 2, promedioSegundos: 90, medianaSegundos: 90, sinMedir: 2 });
  });

  it('ninguna etapa cuenta 0 s cuando empezó y terminó en el mismo paso (asignación automática al recibir)', () => {
    const caso = (rec: number, asig: number, sale: number, llega: number) => medirTiempos([
      { estado: 'recibido', en: en(0) }, { estado: 'validado', en: en(rec) }, { estado: 'asignado', en: en(rec + asig) },
      { estado: 'en_camino', en: en(rec + asig + sale) }, { estado: 'en_sitio', en: en(rec + asig + sale + llega) },
    ], 'alta', t0 + 5000_000);
    // Como en la verificación en vivo: 4 asignaciones, 3 automáticas (0 s) y una de 16 s.
    const ms = [caso(30, 0, 40, 300), caso(20, 0, 50, 400), caso(25, 0, 30, 0), caso(40, 16, 20, 200)];
    expect(ms[0].etapas[1]).toMatchObject({ segundos: null, estado: 'omitida', simultanea: true });
    const r = resumirTiempos(ms);
    expect(r[1]).toMatchObject({ id: 'asignacion', n: 1, promedioSegundos: 16, medianaSegundos: 16, sinMedir: 3 });
    expect(r[3]).toMatchObject({ id: 'traslado', n: 3, medianaSegundos: 300, sinMedir: 1 });
    expect(r[0]).toMatchObject({ id: 'recepcion', n: 4, medianaSegundos: 28, sinMedir: 0 });
    // En ninguna etapa la mediana queda en 0 s.
    for (const f of r) expect(f.medianaSegundos, f.id).not.toBe(0);
  });

  it('la misma acción guarda los hitos con milisegundos de diferencia y sigue siendo el mismo paso', () => {
    const ms = (n: number) => new Date(t0 + n).toISOString();
    const m = medirTiempos([
      { estado: 'recibido', en: ms(0) }, { estado: 'validado', en: ms(20_000) }, { estado: 'asignado', en: ms(20_003) },
      { estado: 'en_camino', en: ms(60_000) }, { estado: 'en_sitio', en: ms(60_400) },
    ], 'alta', t0 + 100_000);
    expect(m.etapas[1]).toMatchObject({ segundos: null, simultanea: true });
    expect(m.etapas[3]).toMatchObject({ segundos: null, simultanea: true });
    expect(m.etapas[2]).toMatchObject({ segundos: 40, estado: 'cumplida' });
  });
});

describe('identidad, opinión y cola', () => {
  const c = { nombre: 'Ana López', telefono: '4421234567', confiabilidad: 1 };
  it('oculta lo que corresponde', () => {
    expect(reportanteVisible({ identidad: 'completa' }, c).telefono).toBe('4421234567');
    expect(reportanteVisible({ identidad: 'seudonimo', alias: 'Vecina' }, c)).toMatchObject({ nombre: 'Vecina', telefono: '••••••4567' });
    expect(reportanteVisible({ identidad: 'anonimo' }, c)).toMatchObject({ nombre: 'Anónimo', telefono: '' });
  });
  it('anónimo solo en incidentes no violentos', () => {
    expect(permiteAnonimo('ruido-rina')).toBe(true);
    expect(permiteAnonimo('disparos')).toBe(false);
    expect(permiteAnonimo('no-existe')).toBe(false);
  });
  it('el alta acepta identidad y por defecto es completa', () => {
    const base = { incidenteId: 'otro', ubicacion: centro };
    expect(CrearReporteSchema.parse(base).identidad).toBe('completa');
    expect(CrearReporteSchema.parse({ ...base, identidad: 'seudonimo', alias: 'Vecino' }).alias).toBe('Vecino');
  });
  it('detecta quejas', () => {
    expect(esQueja(OpinionSchema.parse({ calificacion: 5, llegoUnidad: 'no' }))).toBe(true);
    expect(esQueja(OpinionSchema.parse({ calificacion: 2, llegoUnidad: 'si' }))).toBe(true);
    expect(esQueja(OpinionSchema.parse({ calificacion: 4, llegoUnidad: 'tarde' }))).toBe(false);
  });
  it('envía la cola en orden y se detiene sin conexión', async () => {
    let cola = encolar([], '1', 'a', new Date(t(0)));
    cola = encolar(cola, '2', 'b', new Date(t(0)));
    let enLinea = false;
    const enviar = async (p: { datos: string }) => { if (!enLinea) throw new Error('sin conexión'); return p.datos.toUpperCase(); };
    const r1 = await vaciarCola(cola, enviar);
    expect(r1.enviados).toHaveLength(0);
    expect(r1.restantes[0].intentos).toBe(1);
    expect(debeOfrecer911(r1.restantes[0], t(61))).toBe(true);
    enLinea = true;
    const r2 = await vaciarCola(r1.restantes, enviar);
    expect(r2.enviados.map((e) => e.resultado)).toEqual(['A', 'B']);
    expect(r2.restantes).toHaveLength(0);
  });
});

function t(s: number) { return Date.parse('2026-11-14T10:00:00Z') + s * 1000; }

describe('despacho tras escalar al C5', () => {
  it('el C5 puede mandar unidades de cualquier CAD; un municipio solo las suyas', () => {
    expect(puedeDespachar(CAD_ESTATAL_ID, 'cad-queretaro')).toBe(true);
    expect(puedeDespachar('cad-queretaro', 'cad-queretaro')).toBe(true);
    expect(puedeDespachar('cad-queretaro', 'cad-corregidora')).toBe(false);
  });
  it('advierte si la llegada estimada supera la meta', () => {
    expect(etaSuperaMeta(54, 35 * 60)).toBe(true);
    expect(etaSuperaMeta(10, 13 * 60)).toBe(false);
    expect(etaSuperaMeta(undefined, 600)).toBe(false);
  });
});
