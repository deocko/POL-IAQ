import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FUENTE_COLONIAS, buscarColonias, claveColonia, coloniaDeTexto, coloniaPorId, coloniasPorCp, coloniasQro, coordenadasDeTexto, resolverColonia,
  coloniasDeFilas, contadoresBandeja, filtrarBandeja, filtrosAplicados, sugerenciasBusqueda, SIN_COLONIA,
  ColoniaEntradaSchema, type ColoniaFolio, type FilaBandeja,
} from './index';

const T0 = Date.parse('2026-11-17T17:00:00Z');
const hace = (min: number) => new Date(T0 - min * 60_000).toISOString();
const quien = { actor: 'operador:ana', en: hace(0) };

describe('catálogo de colonias SEPOMEX (seed solo Querétaro)', () => {
  it('coincide con el seed versionado: mismo SHA-256, total y los 18 municipios', () => {
    const bytes = readFileSync(join(__dirname, '..', 'datos', 'colonias-queretaro-sepomex.json'));
    const seed = JSON.parse(bytes.toString('utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(FUENTE_COLONIAS.sha256);
    expect(coloniasQro()).toHaveLength(seed.total_asentamientos);
    expect(FUENTE_COLONIAS.total).toBe(seed.total_asentamientos);
    expect(new Set(coloniasQro().map((c) => c.municipioClave)).size).toBe(18);
    expect(seed.fuente).toMatch(/SEPOMEX/);
    expect(seed.fecha_descarga).toBe('2026-11-19');
  });
  it('ids únicos y estables; cada colonia con CP de Querétaro', () => {
    const ids = coloniasQro().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(coloniasQro().every((c) => /^76\d{3}$/.test(c.cp) && /^220(0[1-9]|1[0-8])$/.test(c.municipioClave))).toBe(true);
    expect(coloniaPorId('76000-centro')).toMatchObject({ nombre: 'Centro', cp: '76000', municipioClave: '22014' });
  });
  it('busca por nombre (sin acentos) y por CP, solo en los municipios pedidos', () => {
    expect(buscarColonias('centro', { municipios: ['22014'] })[0]).toMatchObject({ nombre: 'Centro', municipioClave: '22014' });
    expect(buscarColonias('760', { municipios: ['22014'] }).every((c) => c.cp.startsWith('760') && c.municipioClave === '22014')).toBe(true);
    expect(buscarColonias('76000', { limite: 50 }).map((c) => c.nombre)).toEqual(expect.arrayContaining(['Centro', 'La Cruz']));
    expect(buscarColonias('centro', { municipios: ['22006'] }).every((c) => c.municipioClave === '22006')).toBe(true);
    expect(buscarColonias('7')).toEqual([]);
    expect(coloniasPorCp('76000', ['22006'])).toEqual([]);
  });
});

describe('colonia del folio', () => {
  it('del catálogo: validada y del municipio del folio', () => {
    const r = resolverColonia({ coloniaId: '76000-centro' }, '22014', quien);
    expect(r).toMatchObject({ colonia: { id: '76000-centro', nombre: 'Centro', cp: '76000', fuente: 'sepomex', validada: true, metodo: 'operador' } });
    expect(resolverColonia({ coloniaId: '76000-centro' }, '22006', quien)).toMatchObject({ error: 'colonia_otro_municipio' });
    expect(resolverColonia({ coloniaId: 'no-existe' }, '22014', quien)).toMatchObject({ error: 'colonia_desconocida' });
  });
  it('alta manual: guarda CP y coordenadas, marcada «manual» y por validar', () => {
    const r = resolverColonia({ manual: { nombre: '  Lomas  del   Mirador Nuevo ', cp: '76090', lat: 20.5888, lng: -100.3899 } }, '22014', quien);
    expect(r).toMatchObject({ colonia: { id: null, nombre: 'Lomas del Mirador Nuevo', cp: '76090', fuente: 'manual', validada: false, lat: 20.5888, lng: -100.3899, asignadaPor: 'operador:ana' } });
    // Ubicación en otro municipio o fuera del estado: se rechaza.
    expect(resolverColonia({ manual: { nombre: 'X', cp: '76090', lat: 20.539, lng: -100.442 } }, '22014', quien)).toMatchObject({ error: 'colonia_otro_municipio' });
    expect(resolverColonia({ manual: { nombre: 'X', cp: '76090', lat: 19.43, lng: -99.13 } }, '22014', quien)).toMatchObject({ error: 'ubicacion_fuera' });
    // Si ya existe en el catálogo con ese CP, se usa la del catálogo.
    expect(resolverColonia({ manual: { nombre: 'centro', cp: '76000', lat: 20.5888, lng: -100.3899 } }, '22014', quien)).toMatchObject({ colonia: { id: '76000-centro', fuente: 'sepomex' } });
    expect(ColoniaEntradaSchema.safeParse({ manual: { nombre: 'Nueva', cp: '01000', lat: 20, lng: -100 } }).success).toBe(false);
  });
  it('se deriva del texto solo con una mención explícita y única; si no, sin colonia', () => {
    expect(coloniaDeTexto('Calle Madero 10, Col. Centro, junto al jardín', '22014')).toMatchObject({ id: '76000-centro' });
    expect(coloniaDeTexto('Frente a la tienda, colonia La Cruz C.P. 76000', '22014')).toMatchObject({ nombre: 'La Cruz', cp: '76000' });
    expect(coloniaDeTexto('Jardín Zenea (ubicación de prueba)', '22014')).toBeNull();
    expect(coloniaDeTexto('Col. Centro', '22006')?.municipioClave ?? '22006').toBe('22006');
    expect(coloniaDeTexto('Col. Inventada Que No Existe', '22014')).toBeNull();
    expect(coloniaDeTexto('Col. Centro', null)).toBeNull();
    // CP con varias colonias y sin nombre: no se adivina.
    expect(coloniaDeTexto('C.P. 76000', '22014')).toBeNull();
  });
  it('coordenadas pegadas o enlace de Google Maps', () => {
    expect(coordenadasDeTexto('20.5888, -100.3899')).toEqual({ lat: 20.5888, lng: -100.3899 });
    expect(coordenadasDeTexto('https://www.google.com/maps/@20.5888,-100.3899,17z')).toEqual({ lat: 20.5888, lng: -100.3899 });
    expect(coordenadasDeTexto('https://maps.google.com/?q=20.5888,-100.3899')).toEqual({ lat: 20.5888, lng: -100.3899 });
    expect(coordenadasDeTexto('https://www.google.com/maps/place/X/data=!3d20.5888!4d-100.3899')).toEqual({ lat: 20.5888, lng: -100.3899 });
    expect(coordenadasDeTexto('Centro de Querétaro')).toBeNull();
  });
});

describe('filtros de la bandeja: colonia, teléfono, nombre y búsqueda', () => {
  const centro = resolverColonia({ coloniaId: '76000-centro' }, '22014', quien) as { colonia: ColoniaFolio };
  const cruz = resolverColonia({ coloniaId: '76000-la-cruz' }, '22014', quien) as { colonia: ColoniaFolio };
  const manual = resolverColonia({ manual: { nombre: 'Nueva Esperanza', cp: '76090', lat: 20.5888, lng: -100.3899 } }, '22014', quien) as { colonia: ColoniaFolio };
  const f = (folio: string, prioridad: FilaBandeja['prioridad'], colonia: ColoniaFolio | null, nombre: string, telefono: string, extra: Partial<FilaBandeja> = {}): FilaBandeja => ({
    folio, estado: 'recibido', prioridad, cnie: { prioridad: 'ALTA', tipo: { codigo: '3', nombre: 'Seguridad' }, incidente: { codigo: '30202', nombre: 'Detonación por arma de fuego' } }, municipioClave: '22014', creadoEn: hace(2),
    tiempos: { llegada: { segundos: 120, metaSegundos: 600, estado: 'en_curso', abierta: true } }, incidente: 'Disparos', colonia, reportante: { nombre, telefono, identidad: 'completa' }, ...extra,
  });
  const filas = [
    f('A', 'alta', centro.colonia, 'Ana López', '+524421234567'),
    f('B', 'baja', centro.colonia, 'Beto Ruiz', '+524429998877'),
    f('C', 'alta', cruz.colonia, 'Carla Ana Díaz', '+524421230000'),
    f('D', 'media', null, 'Anónimo', '', { reportante: { nombre: 'Anónimo', telefono: '', identidad: 'anonimo' } }),
    f('E', 'alta', manual.colonia, 'Seudo', '••••••4567', { reportante: { nombre: 'Seudo', telefono: '••••••4567', identidad: 'seudonimo' } }),
  ];
  const folios = (x: FilaBandeja[]) => x.map((r) => r.folio);

  it('filtrar por colonia muestra solo sus folios y el contador es correcto', () => {
    expect(folios(filtrarBandeja(filas, { colonia: '76000-centro' }, T0))).toEqual(['A', 'B']);
    expect(folios(filtrarBandeja(filas, { colonia: SIN_COLONIA }, T0))).toEqual(['D']);
    expect(folios(filtrarBandeja(filas, { colonia: claveColonia(manual.colonia) }, T0))).toEqual(['E']);
    const c = contadoresBandeja(filas, {}, T0);
    expect(c.colonia).toMatchObject({ '76000-centro': 2, '76000-la-cruz': 1, [SIN_COLONIA]: 1, [claveColonia(manual.colonia)]: 1 });
    // Con otro filtro, el contador de colonia refleja ese filtro.
    expect(contadoresBandeja(filas, { prioridad: 'alta' }, T0).colonia).toMatchObject({ '76000-centro': 1, '76000-la-cruz': 1 });
    expect(coloniasDeFilas(filas).map((x) => x.texto)).toEqual(['Centro · CP 76000', 'La Cruz · CP 76000', 'Nueva Esperanza · CP 76090 (manual, por validar)', 'Sin colonia']);
  });
  it('teléfono y nombre del reportante, solos y combinados con otros filtros', () => {
    expect(folios(filtrarBandeja(filas, { telefono: '442 123' }, T0))).toEqual(['A', 'C']);
    expect(folios(filtrarBandeja(filas, { telefono: '442-123', colonia: '76000-centro' }, T0))).toEqual(['A']);
    expect(folios(filtrarBandeja(filas, { nombre: 'ana' }, T0))).toEqual(['A', 'C']);
    expect(folios(filtrarBandeja(filas, { nombre: 'ana', prioridad: 'alta', colonia: '76000-la-cruz' }, T0))).toEqual(['C']);
    // El anónimo no se encuentra por nombre; del seudónimo solo los últimos 4 dígitos.
    expect(folios(filtrarBandeja(filas, { nombre: 'anonimo' }, T0))).toEqual([]);
    expect(folios(filtrarBandeja(filas, { telefono: '4567' }, T0))).toEqual(['A', 'E']);
    expect(folios(filtrarBandeja(filas, { telefono: '4421234567' }, T0))).toEqual(['A']);
  });
  it('búsqueda general: todas las palabras, en cualquier campo; se combina con los filtros', () => {
    expect(folios(filtrarBandeja(filas, { texto: 'cruz disparos' }, T0))).toEqual(['C']);
    expect(folios(filtrarBandeja(filas, { texto: '30202', prioridad: 'baja' }, T0))).toEqual(['B']);
    expect(folios(filtrarBandeja(filas, { cp: '76090' }, T0))).toEqual(['E']);
    expect(contadoresBandeja(filas, { texto: 'centro' }, T0).prioridad).toMatchObject({ alta: 1, baja: 1 });
  });
  it('limpiar: sin filtros vuelve la bandeja completa; el contador de filtros aplicados', () => {
    const filtro = { estado: null, telefono: '442', colonia: '76000-centro', prioridad: 'alta' as const };
    expect(filtrosAplicados(filtro)).toBe(3);
    expect(filtrosAplicados({})).toBe(0);
    expect(filtrarBandeja(filas, {}, T0)).toHaveLength(filas.length);
  });
  it('sugerencias de la barra: buscar en todo, teléfono, CP y colonias de la bandeja', () => {
    expect(sugerenciasBusqueda('442 123', filas).map((s) => [s.campo, s.n])).toEqual([['texto', 2], ['telefono', 2]]);
    expect(sugerenciasBusqueda('76000', filas).map((s) => s.campo)).toEqual(['texto', 'telefono', 'cp', 'colonia', 'colonia']);
    const s = sugerenciasBusqueda('cruz', filas);
    expect(s.find((x) => x.campo === 'colonia')).toMatchObject({ valor: '76000-la-cruz', n: 1 });
    expect(sugerenciasBusqueda('  ', filas)).toEqual([]);
  });
});
