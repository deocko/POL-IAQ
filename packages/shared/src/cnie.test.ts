import { describe, expect, it } from 'vitest';
import {
  CATALOGO_SEMILLA, CODIGOS_CNIE_RETIRADOS, CODIGOS_DEL_MAPEO, INCIDENTES_CNIE, PROTOCOLO_PROVISIONAL, SUBTIPOS_CNIE, TIPOS_CNIE,
  buscarCnie, clasificarCnie, etiquetaCnie, incidenteCnie, incidentePorId, permiteAnonimo, preguntasPara, validarCodigoCnie,
} from './index';

describe('CNIE V 3.0 cargado desde el PDF oficial', () => {
  it('tiene 7 tipos, 25 subtipos vigentes, 361 incidentes vigentes y 12 códigos retirados', () => {
    expect(TIPOS_CNIE).toHaveLength(7);
    expect(SUBTIPOS_CNIE).toHaveLength(25);
    expect(SUBTIPOS_CNIE.map((s) => s.codigo)).not.toContain('502');
    expect(INCIDENTES_CNIE).toHaveLength(361);
    expect(CODIGOS_CNIE_RETIRADOS.map((r) => r.codigo)).toEqual(['10212', '30704', '30902', '50201', '50202', '50203', '60101', '60102', '70102', '70103', '70105', '70108']);
  });

  it('ningún código retirado aparece como vigente', () => {
    for (const r of CODIGOS_CNIE_RETIRADOS) expect(incidenteCnie(r.codigo), r.codigo).toBeUndefined();
  });

  it('valida códigos: vigente, retirado (con su reemplazo), inexistente y mal formado', () => {
    expect(validarCodigoCnie('30202')).toMatchObject({ ok: true, incidente: { nombre: 'DETONACIÓN POR ARMA DE FUEGO', prioridad: 'ALTA' } });
    expect(validarCodigoCnie('30902')).toMatchObject({ ok: false, error: 'retirado', reemplazo: '10112' });
    expect(validarCodigoCnie('10212')).toMatchObject({ ok: false, error: 'retirado' });
    expect(validarCodigoCnie('99999')).toMatchObject({ ok: false, error: 'inexistente' });
    expect(validarCodigoCnie('304')).toMatchObject({ ok: false, error: 'formato' });
  });

  it('los nombres que no venían en el extracto de trabajo coinciden con el PDF', () => {
    const nombres: Record<string, string> = {
      10308: 'PERSONA INCONSCIENTE',
      10305: 'DIFICULTAD RESPIRATORIA/ URGENCIA RESPIRATORIA',
      10307: 'CONVULSIONES',
      10301: 'TRABAJO DE PARTO',
      10302: 'EMERGENCIA OBSTÉTRICA',
      10204: 'PERSONA LESIONADA POR CAÍDA',
      10206: 'PERSONA CON FRACTURA/ TRAUMATISMO EN EXTREMIDADES',
      10207: 'HEMORRAGIA',
      10208: 'PERSONA LESIONADA POR ARMA BLANCA',
      60204: 'SOLICITUD DE INFORMACIÓN',
      10107: 'ACCIDENTE MÚLTIPLE CON PERSONA(S) LESIONADA(S)',
      10314: 'INFARTO/ URGENCIA CARDIOLÓGICA',
    };
    for (const [c, n] of Object.entries(nombres)) expect(incidenteCnie(c)?.nombre, c).toBe(n);
  });

  it('formatea la etiqueta de la consola', () => {
    expect(etiquetaCnie(clasificarCnie('disparos')!)).toBe('CNIE 30202 · Seguridad / Armas y explosivos / Detonación por arma de fuego · ALTA');
    expect(etiquetaCnie(clasificarCnie('robo-en-curso')!)).toBe('CNIE 304 · Seguridad / Patrimonio / incidente por definir');
  });

  it('busca por código o por palabras, sin acentos y sin códigos retirados', () => {
    expect(buscarCnie('304').every((i) => i.codigo.startsWith('304'))).toBe(true);
    expect(buscarCnie('robo casa').map((i) => i.codigo)).toEqual(expect.arrayContaining(['30413', '30414']));
    expect(buscarCnie('detonacion arma').map((i) => i.codigo)).toContain('30202');
    expect(buscarCnie('30902')).toEqual([]);
    expect(buscarCnie('estupro')).toEqual([]);
  });
});

describe('mapeo de las 14 opciones del catálogo ciudadano', () => {
  // [opción, tipo, subtipo, incidente fijo o null, prioridad CNIE]
  const ESPERADO: [string, string | null, string | null, string | null, string | null][] = [
    ['robo-en-curso', '3', '304', null, null],
    ['agresion', '3', '309', '30909', 'ALTA'],
    ['intrusion-domicilio', '3', '310', '31001', 'MEDIA'],
    ['violencia-familiar', '3', '305', '30503', 'ALTA'],
    ['disparos', '3', '302', '30202', 'ALTA'],
    ['persona-sospechosa', '3', '309', '30904', 'MEDIA'],
    ['accidente-vial', '1', '101', null, null],
    ['emergencia-medica', '1', '103', null, null],
    ['persona-lesionada', '1', '102', null, null],
    ['incendio', '2', '203', null, null],
    ['fuga-gas', '2', '201', '20115', 'ALTA'],
    ['inundacion', '2', '202', '20207', 'ALTA'],
    ['ruido-rina', '5', '501', '50105', 'BAJA'],
    ['otro', null, null, null, null],
  ];

  it('cada opción tiene el tipo, subtipo, incidente y prioridad CNIE acordados', () => {
    expect(CATALOGO_SEMILLA).toHaveLength(14);
    for (const [id, tipo, subtipo, incidente, prioridad] of ESPERADO) {
      const e = incidentePorId(id)!;
      expect(e.codigoCnieTipo?.codigo ?? null, id).toBe(tipo);
      expect(e.codigoCnieSubtipo?.codigo ?? null, id).toBe(subtipo);
      expect(e.codigoCnie?.codigo ?? null, id).toBe(incidente);
      expect(e.prioridadCnie, id).toBe(prioridad);
      if (incidente) expect(e.codigoCnie!.codigo).toMatch(/^\d{5}$/);
    }
  });

  it('guarda las dos prioridades cuando difieren (intrusión e inundación)', () => {
    expect(incidentePorId('intrusion-domicilio')).toMatchObject({ prioridad: 'alta', prioridadCnie: 'MEDIA' });
    expect(incidentePorId('inundacion')).toMatchObject({ prioridad: 'media', prioridadCnie: 'ALTA' });
  });

  it('la categoría de "Ruido excesivo" es asistencia (tipo 5)', () => {
    expect(incidentePorId('ruido-rina')!.categoria).toBe('asistencia');
  });

  it('todo código que pueden producir las reglas existe y está vigente', () => {
    for (const c of CODIGOS_DEL_MAPEO) expect(validarCodigoCnie(c).ok, c).toBe(true);
  });

  it('a lo sumo una pregunta afina el código por opción', () => {
    for (const e of CATALOGO_SEMILLA) expect(preguntasPara(PROTOCOLO_PROVISIONAL, e.id).filter((q) => q.afinaCnie).length, e.id).toBeLessThanOrEqual(1);
  });
});

describe('afinar el código con las respuestas', () => {
  const codigo = (id: string, r: Record<string, unknown> = {}) => clasificarCnie(id, r)?.incidente?.codigo ?? null;

  it('robo: por lo que se roba y si hay violencia', () => {
    expect(codigo('robo-en-curso')).toBeNull();
    expect(codigo('robo-en-curso', { que_roban: 'persona' })).toBe('30421');
    expect(codigo('robo-en-curso', { que_roban: 'persona', armas: false })).toBe('30422');
    expect(codigo('robo-en-curso', { que_roban: 'negocio', armas: true })).toBe('30419');
    expect(codigo('robo-en-curso', { que_roban: 'casa', armas: false, heridos: false })).toBe('30414');
    expect(codigo('robo-en-curso', { que_roban: 'vehiculo', armas: false, heridos: true })).toBe('30429');
    expect(codigo('robo-en-curso', { que_roban: 'dentro_auto' })).toBe('30403');
    expect(codigo('robo-en-curso', { que_roban: 'otro' })).toBe('30446');
    expect(codigo('robo-en-curso', { que_roban: 'no_sabe' })).toBe('30446');
  });

  it('accidente sin heridos pasa a 30309 (tipo 3, subtipo 303)', () => {
    const c = clasificarCnie('accidente-vial', { heridos: false })!;
    expect(c).toMatchObject({ tipo: { codigo: '3' }, subtipo: { codigo: '303' }, incidente: { codigo: '30309' }, origen: 'respuestas' });
    expect(codigo('accidente-vial', { heridos: true })).toBeNull();
    expect(codigo('accidente-vial', { heridos: true, tipo_accidente: 'moto' })).toBe('10103');
    expect(codigo('accidente-vial', { heridos: true, tipo_accidente: 'varios' })).toBe('10107');
  });

  it('agresión: riña y código secundario de lesionados', () => {
    expect(codigo('agresion')).toBe('30909');
    expect(codigo('agresion', { pelea_mutua: true })).toBe('31112');
    expect(clasificarCnie('agresion', { heridos: true })!.secundario?.codigo).toBe('10225');
  });

  it('respuestas que cambian el código en las demás opciones', () => {
    expect(codigo('intrusion-domicilio', { robo_casa: true })).toBe('30413');
    expect(codigo('intrusion-domicilio', { robo_casa: true, armas: false })).toBe('30414');
    expect(codigo('violencia-familiar', { es_pareja: true })).toBe('30502');
    expect(codigo('disparos', { en_escuela: true })).toBe('30206');
    expect(codigo('persona-sospechosa', { es_vehiculo: true })).toBe('30307');
    expect(codigo('emergencia-medica', { sintoma: 'dolor_pecho' })).toBe('10314');
    expect(codigo('emergencia-medica', { sintoma: 'caida' })).toBe('10204');
    expect(codigo('emergencia-medica', { consciente: false, respira: false })).toBe('10313');
    expect(codigo('emergencia-medica', { sintoma: 'otro' })).toBe('10316');
    expect(codigo('persona-lesionada', { tipo_lesion: 'cuchillo' })).toBe('10208');
    expect(codigo('persona-lesionada', { sangrado: true })).toBe('10207');
    expect(codigo('persona-lesionada', { tipo_lesion: 'otro' })).toBe('10220');
    expect(codigo('incendio', { tipo_incendio: 'escuela' })).toBe('20302');
    expect(codigo('incendio', { tipo_incendio: 'otro' })).toBe('20311');
    expect(codigo('ruido-rina', { tipo_ruido: 'rina' })).toBe('31112');
    expect(codigo('fuga-gas')).toBe('20115');
  });

  it('"Otra emergencia" toma el código que elige el ciudadano y rechaza los retirados', () => {
    expect(clasificarCnie('otro')).toBeNull();
    expect(clasificarCnie('otro', {}, '20202')).toMatchObject({ incidente: { codigo: '20202' }, origen: 'ciudadano' });
    expect(() => clasificarCnie('otro', {}, '30704')).toThrow(/ya no está vigente/);
  });
});

describe('anónimo según el subtipo CNIE', () => {
  it('no se permite en 302, 304, 305, 309 y 310', () => {
    for (const id of ['robo-en-curso', 'agresion', 'intrusion-domicilio', 'violencia-familiar', 'disparos']) expect(permiteAnonimo(id), id).toBe(false);
  });
  it('sí en accidentes, médicos, protección civil y asistencia', () => {
    for (const id of ['accidente-vial', 'emergencia-medica', 'persona-lesionada', 'incendio', 'fuga-gas', 'inundacion', 'ruido-rina', 'otro']) expect(permiteAnonimo(id), id).toBe(true);
  });
  it('"Persona sospechosa" (309) conserva el anónimo como excepción del mapeo', () => {
    expect(permiteAnonimo('persona-sospechosa')).toBe(true);
    expect(permiteAnonimo('persona-sospechosa', { es_vehiculo: true })).toBe(true);
  });
  it('una respuesta no abre el anónimo si la opción no lo permite, y en "Otra" manda el código elegido', () => {
    expect(permiteAnonimo('agresion', { pelea_mutua: true })).toBe(false);
    expect(permiteAnonimo('otro', {}, '30202')).toBe(false);
    expect(permiteAnonimo('otro', {}, '30604')).toBe(false); // subtipo 306: fuera de ambas listas
    expect(permiteAnonimo('otro', {}, '20115')).toBe(true);
    expect(permiteAnonimo('otro', {}, '30902')).toBe(false);
  });
});
