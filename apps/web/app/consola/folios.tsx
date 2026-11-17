'use client';

/**
 * Tabla dinámica de folios del reporte de cada CAD y por municipio: búsqueda combinada por todos los
 * campos (nombre y teléfono incluidos), filtros por columna, orden, paginación y exportación (CSV y
 * Excel) de exactamente las filas filtradas.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  COLUMNAS_FOLIO, ETIQUETA_CANAL, UMBRALES_SEMAFORO_PREDETERMINADOS, colorSemaforo, consultarFolios, csvTablaFolios, opcionesColumna, pagina, textoCelda, xlsxTablaFolios,
  type ColumnaFolio, type FilaFolio, type UmbralesSemaforo,
} from '@pol-iaq/shared/movil';
import { ESTADO, ErrorApi, ERRORES, api, guardarArchivo, type FiltroReportes } from './consola';

const POR_PAGINA = [10, 25, 50, 100];
const mensaje = (e: unknown) => (e instanceof ErrorApi ? ERRORES[e.codigo] ?? e.mensaje ?? `Error (${e.codigo})` : 'Sin conexión con el API.');
/** Campos clave que la tarjeta muestra siempre en móvil; el resto se ve al expandir. */
const CLAVE_TARJETA = new Set<ColumnaFolio>(['folio', 'municipio', 'estado', 'prioridad', 'demora']);
const ORDENABLES = new Set<ColumnaFolio>(COLUMNAS_FOLIO.map((c) => c.id));

export function TablaFolios({ token, filtro, ahora, titulo, umbrales = UMBRALES_SEMAFORO_PREDETERMINADOS }: { token: string; filtro: FiltroReportes; ahora: number; titulo: string; umbrales?: UmbralesSemaforo }) {
  const [filas, setFilas] = useState<FilaFolio[] | null>(null);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState('');
  const [columnas, setColumnas] = useState<Partial<Record<ColumnaFolio, string>>>({});
  const [orden, setOrden] = useState<{ columna: ColumnaFolio; descendente?: boolean }>({ columna: 'fecha', descendente: true });
  const [n, setN] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const cada5 = Math.floor(ahora / 5000);

  // Tiempo real: se recarga con los datos de la demo (o del API) cada 5 s y con cada cambio de filtro.
  useEffect(() => { api.folios(token, filtro).then((x) => { setFilas(x.filas); setError(''); }).catch((e) => setError(mensaje(e))); }, [token, filtro, cada5]);
  const visibles = useMemo(() => (filas ? consultarFolios(filas, { texto, columnas, orden }) : []), [filas, texto, columnas, orden]);
  const p = pagina(visibles, n, porPagina);
  useEffect(() => { setN(1); }, [texto, columnas, filtro]);

  const ordenar = (c: ColumnaFolio) => setOrden((o) => (o.columna === c ? { columna: c, descendente: !o.descendente } : { columna: c, descendente: c === 'fecha' || c === 'demora' }));
  const filtrar = (c: ColumnaFolio, v: string) => setColumnas((x) => { const y = { ...x }; if (v) y[c] = v; else delete y[c]; return y; });
  const activos = Object.keys(columnas).length + (texto.trim() ? 1 : 0);
  const nombreArchivo = `poliaq-folios-filtrados-${filtro.municipio ?? filtro.cadId ?? 'todos'}-${filtro.fecha ?? ''}`;
  const nota = `${titulo}. Búsqueda: «${texto.trim() || '—'}». Filtros: ${Object.entries(columnas).map(([k, v]) => `${COLUMNAS_FOLIO.find((c) => c.id === k)?.nombre}=${v}`).join(', ') || '—'}. ${visibles.length} folios.`;

  return (
    <div className="c-tarjeta" data-testid="tabla-folios">
      <div className="c-fila">
        <h3>Folios (tabla dinámica)</h3>
        <div className="c-botones">
          <button className="c-boton-sec" disabled={!visibles.length} onClick={() => guardarArchivo({ nombre: `${nombreArchivo}.csv`, tipo: 'text/csv;charset=utf-8', datos: csvTablaFolios(visibles) })} data-testid="exportar-csv-filtrado">{`CSV (${visibles.length})`}</button>
          <button className="c-boton-sec" disabled={!visibles.length} onClick={() => guardarArchivo({ nombre: `${nombreArchivo}.xlsx`, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', datos: xlsxTablaFolios(visibles, nota) })} data-testid="exportar-xlsx-filtrado">{`Excel (${visibles.length})`}</button>
        </div>
      </div>
      <div className="c-form">
        <label className="c-campo c-crece">Buscar en todos los campos
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, teléfono, folio, CNIE, unidad, corporación… (varias palabras: todas deben coincidir)" data-testid="buscar-folios" />
        </label>
        <label className="c-campo">Por página
          <select value={porPagina} onChange={(e) => { setPorPagina(Number(e.target.value)); setN(1); }}>{POR_PAGINA.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        </label>
        {activos > 0 && <button type="button" className="c-enlace" onClick={() => { setTexto(''); setColumnas({}); }}>{`Quitar ${activos} ${activos === 1 ? 'filtro' : 'filtros'}`}</button>}
      </div>
      <p className="suave c-pequeno" role="status" data-testid="conteo-folios">{filas ? `${visibles.length} de ${filas.length} folios${activos ? ' con los filtros' : ''}. La exportación lleva exactamente estas ${visibles.length} filas (sin nombre ni teléfono).` : ''}</p>
      {error && <p className="c-error" role="alert">{error}</p>}
      {!filas && !error && <div className="esqueleto c-esq-tabla" aria-busy="true" />}
      {filas && (
        <ul className="c-folios-tarjetas" data-testid="folios-tarjetas" aria-label="Folios">
          {p.filas.map((f) => (
            <li key={f.folio} className="c-folio-tarjeta">
              <div className="c-fila">
                <span className="c-mono"><strong>{f.folio}</strong></span>
                <span className={`c-sem-chip c-sem-chip-${colorSemaforo(f.demoraFraccion ?? 0, umbrales)}`}>{`Demora ${textoCelda(f, 'demora') || '—'}`}</span>
              </div>
              <div className="c-etiquetas">
                <span className="c-chip c-chip-neutro">{textoCelda(f, 'municipio') || 'Sin municipio'}</span>
                <span className="c-chip">{ESTADO[f.estado]}</span>
                <span className="c-chip">{`Prioridad ${textoCelda(f, 'prioridad') || '—'}`}</span>
              </div>
              <details className="c-folio-mas">
                <summary>Ver todos los campos</summary>
                <dl>
                  {COLUMNAS_FOLIO.filter((c) => !CLAVE_TARJETA.has(c.id)).map((c) => (
                    <div key={c.id}><dt>{c.nombre}</dt><dd className={c.id === 'telefono' ? 'c-mono' : ''}>{c.id === 'canal' ? ETIQUETA_CANAL[f.canal] : textoCelda(f, c.id) || '—'}</dd></div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
          {!p.filas.length && <li className="suave">Sin folios con esos criterios.</li>}
        </ul>
      )}
      {filas && (
        <div className="c-tabla-desliza c-tabla-folios-caja">
          <table className="c-tiempos c-tabla-folios">
            <thead>
              <tr>
                {COLUMNAS_FOLIO.map((c) => (
                  <th key={c.id} scope="col" aria-sort={orden.columna === c.id ? (orden.descendente ? 'descending' : 'ascending') : 'none'}>
                    {ORDENABLES.has(c.id) ? <button type="button" className="c-orden" onClick={() => ordenar(c.id)} data-columna={c.id}>{c.nombre}<span aria-hidden="true">{orden.columna === c.id ? (orden.descendente ? ' ▼' : ' ▲') : ''}</span></button> : c.nombre}
                  </th>
                ))}
              </tr>
              <tr className="c-filtros-columna">
                {COLUMNAS_FOLIO.map((c) => (
                  <th key={c.id}>
                    {c.lista ? (
                      <select value={columnas[c.id] ?? ''} onChange={(e) => filtrar(c.id, e.target.value)} aria-label={`Filtrar ${c.nombre}`} data-filtro={c.id}>
                        <option value="">Todos</option>
                        {opcionesColumna(filas, c.id).map((o) => <option key={o} value={o}>{c.id === 'estado' ? ESTADO[o as keyof typeof ESTADO] ?? o : o}</option>)}
                      </select>
                    ) : c.id === 'demora' ? null : (
                      <input value={columnas[c.id] ?? ''} onChange={(e) => filtrar(c.id, e.target.value)} aria-label={`Filtrar ${c.nombre}`} placeholder="contiene…" data-filtro={c.id} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.filas.map((f) => (
                <tr key={f.folio}>
                  {COLUMNAS_FOLIO.map((c) => (
                    <td key={c.id} className={c.id === 'folio' || c.id === 'telefono' ? 'c-mono' : ''}>
                      {c.id === 'estado' ? ESTADO[f.estado] : c.id === 'canal' ? <span className={`c-chip ${f.canal === '911' ? 'c-chip-911' : ''}`}>{ETIQUETA_CANAL[f.canal]}</span> : c.id === 'demora' ? <span className={`c-sem-chip c-sem-chip-${colorSemaforo(f.demoraFraccion ?? 0, umbrales)}`}>{textoCelda(f, c.id) || '—'}</span> : textoCelda(f, c.id) || '—'}
                    </td>
                  ))}
                </tr>
              ))}
              {!p.filas.length && <tr><td colSpan={COLUMNAS_FOLIO.length} className="suave">Sin folios con esos criterios.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {p.paginas > 1 && (
        <div className="c-paginas" role="navigation" aria-label="Páginas">
          <button className="c-boton-sec" disabled={p.pagina <= 1} onClick={() => setN(p.pagina - 1)}>Anterior</button>
          <span data-testid="pagina">{`Página ${p.pagina} de ${p.paginas}`}</span>
          <button className="c-boton-sec" disabled={p.pagina >= p.paginas} onClick={() => setN(p.pagina + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}
