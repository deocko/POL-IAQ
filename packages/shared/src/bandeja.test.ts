import { describe, expect, it } from 'vitest';
import {
  INCIDENTES_MAL_USO, TIPOS_CNIE_CIUDADANO, buscarCnie, clasificacionDe, esMalUso,
  claseSesnsp, filasSesnsp, estadistica, medirTiempos,
  colorSemaforo, contadoresBandeja, filtrarBandeja, ordenarBandeja, semaforoDe, validarUmbrales, grupoEstado,
  consultarFolios, csvTablaFolios, filaFolio, pagina, type FilaBandeja, type FilaEstadistica,
} from './index';

const T0 = Date.parse('2026-11-17T17:00:00Z');
const hace = (min: number) => new Date(T0 - min * 60_000).toISOString();

describe('Mal Uso del servicio (tipo 7): solo operador', () => {
  it('no aparece en los tipos ni en la búsqueda del ciudadano; sí para el operador', () => {
    expect(TIPOS_CNIE_CIUDADANO.map((t) => t.codigo)).not.toContain('7');
    expect(buscarCnie('broma', 30, { ciudadano: true })).toEqual([]);
    expect(buscarCnie('701', 30, { ciudadano: true })).toEqual([]);
    expect(buscarCnie('broma').map((i) => i.codigo)).toEqual(expect.arrayContaining(['70101', '70107']));
    expect(INCIDENTES_MAL_USO.length).toBeGreaterThan(0);
    expect(INCIDENTES_MAL_USO.every((i) => esMalUso(i.codigo))).toBe(true);
  });

  it('un folio recatalogado a tipo 7 cuenta como improcedente en el SESNSP y en la estadística', () => {
    expect(claseSesnsp('cerrado', '7')).toBe('improcedente_cancelado');
    expect(claseSesnsp('cerrado', '3')).toBe('procedente');
    const t = medirTiempos([{ estado: 'recibido', en: hace(10) }], 'alta', T0);
    const fila = (folio: string, cnie: string, estado: FilaEstadistica['estado']): FilaEstadistica => ({
      folio, cadId: 'cad-queretaro', municipioClave: '22014', creadoEn: hace(10), prioridad: 'alta', estado, cnie: clasificacionDe(cnie, 'operador'), tiempos: t, queja: false,
    });
    const filas = [fila('A', '30202', 'cerrado'), fila('B', '70107', 'validado'), fila('C', '30202', 'improcedente')];
    const s = filasSesnsp('2026-11', filas);
    expect(s.find((x) => x.incidente === '70107')).toMatchObject({ total: 1, procedentes: 0, improcedentesCancelados: 1 });
    const e = estadistica(filas);
    expect(e).toMatchObject({ reportes: 3, procedentes: 1, improcedentes: 2 });
    expect(e.porMunicipio[0]).toMatchObject({ procedentes: 1, improcedentes: 2 });
  });
});

describe('semáforo por demora', () => {
  const abierto = (min: number, metaMin = 13): FilaBandeja => ({
    folio: `F${min}`, estado: 'recibido', prioridad: 'alta', cnie: null, municipioClave: '22014', creadoEn: hace(min),
    tiempos: { llegada: { segundos: min * 60, metaSegundos: metaMin * 60, estado: 'en_curso', abierta: true } },
  });
  it('verde < 50 %, amarillo 50 %–100 %, rojo > 100 % de la meta', () => {
    expect(colorSemaforo(0.49)).toBe('verde');
    expect(colorSemaforo(0.5)).toBe('amarillo');
    expect(colorSemaforo(1)).toBe('amarillo');
    expect(colorSemaforo(1.01)).toBe('rojo');
    expect(semaforoDe(abierto(2), T0).color).toBe('verde');
    expect(semaforoDe(abierto(8), T0).color).toBe('amarillo');
    expect(semaforoDe(abierto(20), T0).color).toBe('rojo');
  });
  it('cambia de color con el tiempo y respeta umbrales configurados', () => {
    const f = abierto(2);
    expect(semaforoDe(f, T0 + 5 * 60_000).color).toBe('amarillo');
    expect(semaforoDe(f, T0 + 15 * 60_000).color).toBe('rojo');
    expect(semaforoDe(f, T0, { amarillo: 0.1, rojo: 0.2 }).color).toBe('amarillo');
    expect(validarUmbrales({ amarillo: 0.8, rojo: 0.5 })).toMatch(/mayor/);
    expect(validarUmbrales({ amarillo: 0.5, rojo: 1 })).toBeNull();
  });
  it('con la unidad ya en el lugar, la demora queda fija', () => {
    const f: FilaBandeja = { ...abierto(30), estado: 'en_sitio', tiempos: { llegada: { segundos: 300, metaSegundos: 780, estado: 'cumplida' } } };
    expect(semaforoDe(f, T0 + 3600_000)).toMatchObject({ color: 'verde', segundos: 300, corriendo: false });
  });
});

describe('filtros, contadores y orden de la bandeja', () => {
  const f = (folio: string, estado: FilaBandeja['estado'], prioridad: FilaBandeja['prioridad'], mun: string, min: number): FilaBandeja => ({
    folio, estado, prioridad, cnie: { prioridad: prioridad === 'alta' ? 'ALTA' : 'MEDIA' }, municipioClave: mun, creadoEn: hace(min),
    tiempos: { llegada: { segundos: min * 60, metaSegundos: 600, estado: 'en_curso', abierta: true } },
  });
  const filas = [f('A', 'recibido', 'alta', '22014', 1), f('B', 'recibido', 'baja', '22014', 20), f('C', 'asignado', 'alta', '22006', 8), f('D', 'cerrado', 'media', '22014', 30), f('E', 'recibido', 'alta', '22014', 12)];

  it('grupos: nuevos, pendientes, atendidos', () => {
    expect(['recibido', 'transferido', 'validado', 'en_sitio', 'cerrado', 'improcedente'].map((e) => grupoEstado(e as never))).toEqual(['nuevos', 'nuevos', 'pendientes', 'pendientes', 'atendidos', 'atendidos']);
  });
  it('los filtros combinan y los contadores reflejan los demás filtros', () => {
    expect(filtrarBandeja(filas, { estado: 'nuevos', prioridad: 'alta' }, T0).map((x) => x.folio)).toEqual(['A', 'E']);
    expect(filtrarBandeja(filas, { municipio: '22006' }, T0).map((x) => x.folio)).toEqual(['C']);
    const c = contadoresBandeja(filas, { prioridad: 'alta' }, T0);
    expect(c.estado).toMatchObject({ nuevos: 2, pendientes: 1 });
    expect(c.prioridad).toMatchObject({ alta: 3, baja: 1, media: 1 });
    expect(c.municipio).toMatchObject({ '22014': 2, '22006': 1 });
    expect(c.demora).toMatchObject({ verde: 1, amarillo: 1, rojo: 1 });
  });
  it('por defecto: mayor prioridad y, dentro de ella, más demora; terminados al final', () => {
    expect(ordenarBandeja(filas, 'prioridad_demora', T0).map((x) => x.folio)).toEqual(['E', 'C', 'A', 'B', 'D']);
    expect(ordenarBandeja(filas, 'demora', T0).map((x) => x.folio)).toEqual(['B', 'E', 'C', 'A', 'D']);
  });
});

describe('tabla dinámica de folios', () => {
  const t = medirTiempos([{ estado: 'recibido', en: hace(5) }], 'alta', T0);
  const datos = (folio: string, nombre: string, telefono: string, mun: string, cnie: string, prioridad: string, extra: Partial<Parameters<typeof filaFolio>[0]> = {}) => filaFolio({
    folio, creadoEn: hace(Number(folio.slice(-2))), municipioClave: mun, cadId: 'cad-queretaro', estado: 'recibido', prioridad, cnie: clasificacionDe(cnie, 'catalogo'),
    reportante: { nombre, telefono, identidad: 'completa' }, tiempos: t, ...extra,
  }, T0);
  const filas = [
    datos('QRO-014-2026-000001', 'Ana López', '+52 442 111 2233', '22014', '30202', 'alta', { origen: '911', tipoTelefono: 'fijo' }),
    datos('QRO-014-2026-000002', 'Luis Pérez', '4425556677', '22014', '50105', 'baja'),
    datos('QRO-006-2026-000003', 'Ana Ruiz', '4429990000', '22006', '30202', 'alta', { reportante: { nombre: 'Anónimo', telefono: '', identidad: 'anonimo' }, ruta: { canal: '089' } }),
  ];
  it('busca por nombre y por teléfono (con o sin espacios)', () => {
    expect(consultarFolios(filas, { texto: 'ana' }).map((f) => f.folio)).toEqual(['QRO-014-2026-000001']);
    expect(consultarFolios(filas, { texto: '4421112233' }).map((f) => f.folio)).toEqual(['QRO-014-2026-000001']);
    expect(consultarFolios(filas, { texto: '555 6677' }).map((f) => f.folio)).toEqual(['QRO-014-2026-000002']);
    // Del anónimo no se ve ni se busca nombre ni teléfono.
    expect(consultarFolios(filas, { texto: '4429990000' })).toEqual([]);
  });
  it('combina búsqueda y filtros por columna; canal y tipo de teléfono', () => {
    expect(consultarFolios(filas, { texto: '30202' })).toHaveLength(2);
    expect(consultarFolios(filas, { texto: '30202', columnas: { municipio: '22014 Querétaro' } }).map((f) => f.folio)).toEqual(['QRO-014-2026-000001']);
    expect(consultarFolios(filas, { columnas: { canal: 'Llamada 911', tipoTelefono: 'Fijo' } })).toHaveLength(1);
    expect(consultarFolios(filas, { columnas: { canal: 'Anónimo (089)' } })).toHaveLength(1);
  });
  it('ordena por fecha y prioridad, pagina y exporta solo lo filtrado', () => {
    expect(consultarFolios(filas, { orden: { columna: 'fecha', descendente: true } }).map((f) => f.folio.slice(-1))).toEqual(['1', '2', '3']);
    expect(consultarFolios(filas, { orden: { columna: 'prioridad' } }).map((f) => f.prioridad)).toEqual(['alta', 'alta', 'baja']);
    expect(pagina(filas, 2, 2)).toMatchObject({ pagina: 2, paginas: 2, total: 3 });
    const csv = csvTablaFolios(consultarFolios(filas, { texto: 'luis' }));
    expect(csv.trim().split('\r\n')).toHaveLength(2);
    expect(csv).toContain('QRO-014-2026-000002');
    expect(csv).not.toContain('Luis');
  });
});
