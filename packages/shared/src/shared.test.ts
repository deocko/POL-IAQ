import { describe, expect, it } from 'vitest';
import { enrutarPorUbicacion, generarFolio, parsearFolio, puedeTransicionar, firmar, verificarFirma, CAD_ESTATAL_ID, EventoDesdeCadSchema } from './index';

describe('folio unificado', () => {
  it('genera y parsea', () => {
    const folio = generarFolio('014', 2026, 123);
    expect(folio).toBe('QRO-014-2026-000123');
    expect(parsearFolio(folio)).toEqual({ claveMunicipio: '014', anio: 2026, consecutivo: 123 });
  });
  it('usa clave estatal fuera de los pilotos', () => {
    expect(generarFolio(null, 2026, 1)).toBe('QRO-000-2026-000001');
  });
  it('rechaza consecutivos fuera de rango', () => {
    expect(() => generarFolio('014', 2026, 0)).toThrow();
  });
});

describe('enrutamiento por geocerca', () => {
  it('centro de Querétaro va al CAD de Querétaro', () => {
    expect(enrutarPorUbicacion(20.5888, -100.3899).cadId).toBe('cad-queretaro');
  });
  it('El Pueblito va al CAD de Corregidora', () => {
    expect(enrutarPorUbicacion(20.539, -100.442).cadId).toBe('cad-corregidora');
  });
  it('La Cañada va al CAD de El Marqués', () => {
    expect(enrutarPorUbicacion(20.61, -100.32).cadId).toBe('cad-el-marques');
  });
  it('San Juan del Río va al C5', () => {
    expect(enrutarPorUbicacion(20.389, -99.996).cadId).toBe(CAD_ESTATAL_ID);
  });
});

describe('máquina de estados', () => {
  it('permite el camino feliz', () => {
    expect(puedeTransicionar('recibido', 'validado')).toBe(true);
    expect(puedeTransicionar('en_sitio', 'cerrado')).toBe(true);
  });
  it('no reabre un incidente cerrado', () => {
    expect(puedeTransicionar('cerrado', 'asignado')).toBe(false);
  });
});

describe('firma de webhooks', () => {
  it('verifica una firma válida y rechaza una alterada o vieja', () => {
    const ts = 1_800_000_000;
    const f = firmar('secreto', ts, '{"a":1}');
    expect(verificarFirma('secreto', ts, '{"a":1}', f, ts)).toBe(true);
    expect(verificarFirma('secreto', ts, '{"a":2}', f, ts)).toBe(false);
    expect(verificarFirma('secreto', ts, '{"a":1}', f, ts + 600)).toBe(false);
  });
});

describe('contrato CAD', () => {
  it('valida un evento unidad.asignada', () => {
    const r = EventoDesdeCadSchema.safeParse({
      eventoId: '3f1c2a4e-8a6b-4c1d-9e2f-0a1b2c3d4e5f', folio: 'QRO-014-2026-000001', secuencia: 1,
      ocurridoEn: '2026-11-13T12:00:00Z', tipo: 'unidad.asignada',
      datos: { unidadId: 'P-102', corporacion: 'policia_municipal', etiqueta: 'Patrulla 102', etaMinutos: 6 },
    });
    expect(r.success).toBe(true);
  });
});
