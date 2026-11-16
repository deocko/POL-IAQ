import { describe, expect, it } from 'vitest';
import {
  AltaCadSchema, CAD_ESTATAL_ID, CAD_IDS, CASOS_PRUEBA_CAD, MUNICIPIOS_QRO, casosPendientes, cerrarMes, claveCompleta, csvSesnsp, enrutarPorUbicacion,
  estadistica, estadisticaPublica, generarFolio, ipPermitida, medirTiempos, municipioEn, municipioPorClave, puntoEnPoligono, rangoPeriodo, tipoUnidadDe, xlsxSesnsp,
  incidenteCnie, type FilaEstadistica,
} from './index';

const CLAVES = {
  '22001': 'Amealco de Bonfil', '22002': 'Pinal de Amoles', '22003': 'Arroyo Seco', '22004': 'Cadereyta de Montes', '22005': 'Colón', '22006': 'Corregidora',
  '22007': 'Ezequiel Montes', '22008': 'Huimilpan', '22009': 'Jalpan de Serra', '22010': 'Landa de Matamoros', '22011': 'El Marqués', '22012': 'Pedro Escobedo',
  '22013': 'Peñamiller', '22014': 'Querétaro', '22015': 'San Joaquín', '22016': 'San Juan del Río', '22017': 'Tequisquiapan', '22018': 'Tolimán',
};

/** Un punto dentro del polígono (busca en una rejilla sobre su caja). */
function puntoInterior(p: readonly (readonly [number, number])[]): [number, number] {
  const xs = p.map((c) => c[0]), ys = p.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
    const q: [number, number] = [x0 + ((x1 - x0) * i) / 40, y0 + ((y1 - y0) * j) / 40];
    if (puntoEnPoligono(q, p)) return q;
  }
  throw new Error('sin punto interior');
}

describe('los 18 municipios de Querétaro', () => {
  it('tienen la clave INEGI de 5 dígitos verificada y el nombre oficial', () => {
    expect(MUNICIPIOS_QRO).toHaveLength(18);
    expect(Object.fromEntries(MUNICIPIOS_QRO.map((m) => [m.clave, m.nombre]))).toEqual(CLAVES);
    for (const m of MUNICIPIOS_QRO) expect(m.claveFolio).toBe(m.clave.slice(2));
  });

  it('cada uno tiene su cadId; con el C5 son 19 destinos del contrato', () => {
    expect(MUNICIPIOS_QRO.find((m) => m.clave === '22016')?.cadId).toBe('cad-san-juan-del-rio');
    expect(MUNICIPIOS_QRO.find((m) => m.clave === '22013')?.cadId).toBe('cad-penamiller');
    expect(CAD_IDS).toHaveLength(19);
    expect(new Set(CAD_IDS).size).toBe(19);
    expect(CAD_IDS).toEqual(expect.arrayContaining(['cad-queretaro', 'cad-corregidora', 'cad-el-marques', CAD_ESTATAL_ID]));
  });

  it('el folio conserva su formato (3 dígitos) y municipioClave lleva los 5', () => {
    const m = municipioPorClave('22014')!;
    expect(generarFolio(m.claveFolio, 2026, 1)).toBe('QRO-014-2026-000001');
    expect(claveCompleta('014')).toBe('22014');
    expect(claveCompleta('22006')).toBe('22006');
  });

  it('la geocerca de cada municipio enruta a ese municipio, sin traslapes', () => {
    for (const m of MUNICIPIOS_QRO) {
      const [lng, lat] = puntoInterior(m.geocerca);
      expect(municipioEn(lat, lng)?.clave, m.nombre).toBe(m.clave);
      expect(MUNICIPIOS_QRO.filter((x) => puntoEnPoligono([lng, lat], x.geocerca)).length, m.nombre).toBe(1);
      expect(enrutarPorUbicacion(lat, lng, () => true).cadId).toBe(m.cadId);
    }
  });

  it('un municipio no conectado va al C5 (como hoy) aunque su clave quede en el folio', () => {
    const sjr = enrutarPorUbicacion(20.389, -99.996);
    expect(sjr.cadId).toBe(CAD_ESTATAL_ID);
    expect(sjr.municipio?.clave).toBe('22016');
    expect(enrutarPorUbicacion(20.389, -99.996, (c) => c === 'cad-san-juan-del-rio').cadId).toBe('cad-san-juan-del-rio');
    expect(enrutarPorUbicacion(19.43, -99.13).municipio).toBeNull(); // CDMX: fuera de Querétaro
  });
});

describe('alta de un CAD', () => {
  const base = { cadId: 'cad-san-juan-del-rio', nombre: 'CAD San Juan del Río', clave: '22016', modo: 'webhook', webhookUrl: 'https://cad.sjr.example/poliaq', secreto: 'x'.repeat(40), contactoTecnico: { nombre: 'Responsable técnico', correo: 'tecnico@example.org' } };
  it('acepta un alta completa y valida que la clave sea la del municipio', () => {
    expect(AltaCadSchema.safeParse(base).success).toBe(true);
    expect(AltaCadSchema.safeParse({ ...base, clave: '016' }).success).toBe(false);
    expect(AltaCadSchema.safeParse({ ...base, clave: '22014' }).success).toBe(false);
    expect(AltaCadSchema.safeParse({ ...base, cadId: 'cad-inventado' }).success).toBe(false);
    expect(AltaCadSchema.safeParse({ ...base, webhookUrl: undefined }).success).toBe(false);
    expect(AltaCadSchema.safeParse({ ...base, modo: 'consola', webhookUrl: undefined }).success).toBe(true);
    expect(AltaCadSchema.safeParse({ ...base, secreto: 'corto' }).success).toBe(false);
  });
  it('lista de IPs con CIDR y los 8 casos obligatorios', () => {
    expect(ipPermitida('10.1.2.3', ['10.1.0.0/16'])).toBe(true);
    expect(ipPermitida('::ffff:10.1.2.3', ['10.1.0.0/16'])).toBe(true);
    expect(ipPermitida('10.2.0.1', ['10.1.0.0/16', '192.168.1.5'])).toBe(false);
    expect(ipPermitida('1.2.3.4', [])).toBe(true);
    expect(CASOS_PRUEBA_CAD.map((c) => c.id)).toEqual(['acuse', 'asignacion', 'gps', 'cierre', 'reclasificacion', 'transferencia', 'reintentos', 'duplicado']);
    expect(casosPendientes({ acuse: { ok: true, en: '' }, gps: { ok: false, en: '' } })).toHaveLength(7);
  });
  it('tipo de unidad', () => {
    expect(tipoUnidadDe({ unidadId: 'M-1', etiqueta: 'Motopatrulla 1', corporacion: 'policia_municipal' })).toBe('motopatrulla');
    expect(tipoUnidadDe({ unidadId: 'A-1', etiqueta: 'Unidad 1', corporacion: 'cruz_roja' })).toBe('ambulancia');
    expect(tipoUnidadDe({ unidadId: 'P-1', etiqueta: 'Patrulla 1', corporacion: 'policia_municipal' })).toBe('patrulla');
  });
});

const T0 = Date.UTC(2026, 9, 10, 18); // 10 de octubre de 2026, 12:00 en Querétaro
const fila = (folio: string, clave: string | null, codigo: string, estado: FilaEstadistica['estado'], llegadaSeg = 600, dias = 0): FilaEstadistica => {
  const i = incidenteCnie(codigo)!;
  const t = T0 + dias * 86400_000;
  const en = (s: number) => new Date(t + s * 1000).toISOString();
  return {
    folio, cadId: 'cad-queretaro', municipioClave: clave, creadoEn: en(0), prioridad: 'alta', estado,
    cnie: { tipo: i.tipo, subtipo: i.subtipo, incidente: { codigo: i.codigo, nombre: i.nombre } },
    unidad: { unidadId: 'P-101', etiqueta: 'Patrulla 101', corporacion: 'policia_municipal' },
    tiempos: medirTiempos([{ estado: 'recibido', en: en(0) }, { estado: 'validado', en: en(30) }, { estado: 'asignado', en: en(60) }, { estado: 'en_camino', en: en(90) }, { estado: 'en_sitio', en: en(llegadaSeg) }], 'alta', t + 9e6),
    queja: false,
  };
};

describe('estadística y reporte mensual al SESNSP', () => {
  it('agrupa por municipio (5 dígitos), CNIE, corporación y unidad', () => {
    const e = estadistica([fila('A', '22014', '30202', 'cerrado'), fila('B', '22014', '30202', 'cerrado', 900), fila('C', '22006', '10104', 'improcedente')]);
    expect(e.porMunicipio.map((g) => [g.clave, g.reportes])).toEqual([['22014', 2], ['22006', 1]]);
    expect(e.porIncidente[0]).toMatchObject({ clave: '30202', reportes: 2 });
    expect(e.porCorporacion[0]).toMatchObject({ clave: 'policia_municipal', nombre: 'Policía municipal', reportes: 3 });
    expect(e.porUnidad[0]).toMatchObject({ clave: 'P-101', reportes: 3 });
  });

  it('periodos diario, semanal (lunes a domingo) y mensual', () => {
    expect(rangoPeriodo('diario', '2026-11-15')).toMatchObject({ desde: '2026-11-15', hasta: '2026-11-16' });
    expect(rangoPeriodo('semanal', '2026-11-15')).toMatchObject({ desde: '2026-11-09', hasta: '2026-11-16' });
    expect(rangoPeriodo('mensual', '2026-11-15')).toMatchObject({ desde: '2026-11-01', hasta: '2026-12-01', etiqueta: '2026-11' });
  });

  it('la versión pública no lleva folios ni unidades y oculta grupos chicos', () => {
    const filas = [...Array(6)].map((_, i) => fila(`Q${i}`, '22014', '30202', 'cerrado')).concat([fila('X', '22006', '10104', 'cerrado')]);
    const p = estadisticaPublica(filas, rangoPeriodo('mensual', '2026-10-10'));
    const texto = JSON.stringify(p);
    expect(texto).not.toMatch(/Q0|P-101|Patrulla/);
    expect(p.porMunicipio.map((g) => g.clave)).toEqual(['22014', 'otros']);
  });

  it('cierre mensual: congela el mes y las correcciones van en el mes siguiente', () => {
    const octubre = [fila('F1', '22014', '30202', 'cerrado'), fila('F2', '22014', '30202', 'cerrado'), fila('F3', '22006', '10104', 'cancelado')];
    const c10 = cerrarMes('2026-10', octubre, [], () => undefined, 'supervisor', '2026-11-01T06:00:00Z');
    expect(c10.filas).toHaveLength(2);
    expect(c10.filas.find((f) => f.claveMunicipio === '22014')).toMatchObject({ mes: '2026-10', municipio: 'Querétaro', tipo: '3', subtipo: '302', incidente: '30202', total: 2, procedentes: 2, improcedentesCancelados: 0 });
    expect(c10.filas.find((f) => f.claveMunicipio === '22006')).toMatchObject({ total: 1, procedentes: 0, improcedentesCancelados: 1 });
    expect(c10.filas[0].medianas.llegada).toBe(600);
    const congelado = JSON.stringify(c10);
    expect(() => cerrarMes('2026-10', octubre, [c10], () => undefined, 'x')).toThrow(/ya está cerrado/);

    // En noviembre, F2 resultó improcedente y se le corrigió el código: va como ajuste de octubre.
    const hoy = new Map([['F1', octubre[0]], ['F2', { ...fila('F2', '22014', '30309', 'improcedente') }], ['F3', octubre[2]]]);
    const noviembre = [fila('N1', '22016', '30202', 'cerrado', 700, 30)];
    const c11 = cerrarMes('2026-11', noviembre, [c10], (f) => hoy.get(f), 'supervisor', '2026-12-01T06:00:00Z');
    expect(JSON.stringify(c10)).toBe(congelado);
    expect(c11.filas.map((f) => [f.claveMunicipio, f.total])).toEqual([['22016', 1]]);
    expect(c11.ajustes).toEqual([
      expect.objectContaining({ mesOrigen: '2026-10', claveMunicipio: '22014', cnie: '30202', deltaTotal: -1, deltaProcedentes: -1, deltaImprocedentesCancelados: 0 }),
      expect.objectContaining({ mesOrigen: '2026-10', claveMunicipio: '22014', cnie: '30309', deltaTotal: 1, deltaProcedentes: 0, deltaImprocedentesCancelados: 1 }),
    ]);
    expect(c11.ajustes[0].nota).toMatch(/Corrección del 2026-10: folio F2 cambió de procedente a improcedente o cancelado, CNIE 30202 a 30309/);
    // Un tercer cierre no vuelve a ajustar lo que ya se ajustó.
    const c12 = cerrarMes('2026-12', [], [c10, c11], (f) => hoy.get(f) ?? noviembre.find((x) => x.folio === f), 'supervisor');
    expect(c12.ajustes).toEqual([]);
  });

  it('exporta CSV y Excel sin datos personales', () => {
    const c = cerrarMes('2026-10', [fila('F1', '22014', '30202', 'cerrado')], [], () => undefined, 'supervisor');
    const csv = csvSesnsp(c);
    expect(csv.startsWith('﻿mes,clave_municipio,municipio,cnie_tipo')).toBe(true);
    expect(csv).toContain('2026-10,22014,Querétaro,3,');
    expect(csv).not.toContain('F1');
    const xlsx = xlsxSesnsp(c);
    expect([...xlsx.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(xlsx)).toContain('xl/worksheets/sheet3.xml');
  });
});
