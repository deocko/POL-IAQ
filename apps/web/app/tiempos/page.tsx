'use client';

/**
 * Versión pública de tiempos de respuesta: agregada por municipio y CNIE, sin folios, ubicaciones,
 * unidades ni datos personales. Los grupos con menos de 5 reportes se suman en «Otros».
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { duracionTexto, MINIMO_PUBLICO, type Periodo } from '@pol-iaq/shared/movil';
import { Marca } from '../../lib/marca';
import { DEMO, tiemposPublicos } from '../consola/consola';
import '../consola/consola.css';

type Publica = Awaited<ReturnType<typeof tiemposPublicos>>;
const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function Tabla({ titulo, filas }: { titulo: string; filas: Publica['porMunicipio'] }) {
  if (!filas.length) return null;
  return (
    <div className="c-tabla-desliza">
      <table className="c-tiempos" aria-label={titulo}>
        <thead><tr><th scope="col">{titulo}</th><th scope="col">Reportes</th><th scope="col">Llegada (mediana)</th><th scope="col">En meta</th><th scope="col">Quejas</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave}>
              <th scope="row">{f.clave === 'otros' || f.clave === '000' || f.clave === 'sin' ? f.nombre : <><span className="c-mono">{f.clave}</span>{` ${f.nombre}`}</>}</th>
              <td>{f.reportes}</td>
              <td>{f.llegadaMedianaSeg == null ? '—' : duracionTexto(f.llegadaMedianaSeg)}</td>
              <td>{f.llegadaEnMeta == null ? '—' : `${f.llegadaEnMeta}%`}</td>
              <td>{f.quejas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TiemposPublicos() {
  const [periodo, setPeriodo] = useState<Periodo>('mensual');
  const [fecha, setFecha] = useState('');
  const [d, setD] = useState<Publica | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setFecha(hoyLocal()); }, []);
  useEffect(() => {
    if (!fecha) return;
    setError('');
    tiemposPublicos(periodo, fecha).then(setD).catch(() => setError('No se pudieron cargar los datos. Intenta de nuevo.'));
  }, [periodo, fecha]);

  return (
    <main className="c-publico">
      <div className="legal-cabeza">
        <Link href="/" aria-label="POL-IAQ, ir al inicio"><Marca tam={36} /></Link>
        <Link href="/">Inicio</Link>
      </div>
      <h1>Tiempos de respuesta en Querétaro</h1>
      <p className="suave">{`Datos agregados de los reportes hechos con POL-IAQ. Sin información personal: no se publican folios, ubicaciones ni unidades, y los grupos con menos de ${MINIMO_PUBLICO} reportes se suman en «Otros».`}</p>
      {DEMO && <p className="c-demo c-demo-barra">{'Demo: los números salen de los reportes de prueba hechos en este navegador.'}</p>}
      <div className="c-form c-filtros" role="group" aria-label="Periodo">
        <label className="c-campo">Periodo<select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}><option value="diario">Diario</option><option value="semanal">Semanal</option><option value="mensual">Mensual</option></select></label>
        <label className="c-campo">Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoyLocal())} /></label>
      </div>
      {error && <div className="estado estado-error" role="alert"><p>{error}</p><button className="c-boton" onClick={() => setFecha(hoyLocal())}>Reintentar</button></div>}
      {!d && !error && <div aria-busy="true"><div className="esqueleto c-esq-tabla" /><span className="solo-lector">Cargando…</span></div>}
      {d && (
        <section aria-label="Resultados" data-testid="publico">
          <p className="suave c-pequeno">{`Periodo ${d.periodo.etiqueta} · ${d.reportes} ${d.reportes === 1 ? 'reporte' : 'reportes'}`}</p>
          {d.reportes < MINIMO_PUBLICO ? (
            <div className="estado c-tarjeta"><h2>Aún no hay suficientes reportes</h2><p>{`Publicamos cuando un periodo tiene al menos ${MINIMO_PUBLICO} reportes, para que nadie pueda ser identificado.`}</p></div>
          ) : <>
            <div className="c-tarjeta">
              <h2>Por etapa</h2>
              <div className="c-tabla-desliza">
                <table className="c-tiempos"><thead><tr><th scope="col">Etapa</th><th scope="col">Medidos</th><th scope="col">Mediana</th><th scope="col">En meta</th></tr></thead>
                  <tbody>{d.etapas.map((x) => <tr key={x.id}><th scope="row">{x.nombre}</th><td>{x.medidos}</td><td>{x.medianaSeg == null ? '—' : duracionTexto(x.medianaSeg)}</td><td>{x.enMeta == null ? '—' : `${x.enMeta}%`}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="c-tarjeta"><h2>Por municipio</h2><Tabla titulo="Municipio" filas={d.porMunicipio} /></div>
            <div className="c-tarjeta"><h2>Por tipo de emergencia (CNIE)</h2><Tabla titulo="Tipo" filas={d.porTipo} /><Tabla titulo="Subtipo" filas={d.porSubtipo} /></div>
          </>}
          <p className="suave c-pequeno">{d.nota}</p>
        </section>
      )}
    </main>
  );
}
