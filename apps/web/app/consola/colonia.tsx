'use client';

/**
 * Colonia del folio en la consola: elegirla del catálogo SEPOMEX (por código postal o nombre) o, si no está,
 * darla de alta a mano con su código postal y su ubicación (coordenadas o enlace de Google Maps, o el GPS del
 * dispositivo). La manual queda marcada «manual, por validar». Se usa en el alta 911 y en el detalle del folio.
 */
import { useId, useMemo, useState } from 'react';
import {
  buscarColonias, coloniaPorId, coordenadasDeTexto, municipioPorClave, resolverColonia, textoColonia,
  type ColoniaCatalogo, type ColoniaEntrada,
} from '@pol-iaq/shared/movil';
import { hora, type Reporte } from './consola';

/** Texto de lo elegido, para mostrarlo antes de guardar. */
export function textoEntrada(e: ColoniaEntrada | null): string {
  if (!e) return '';
  if ('coloniaId' in e) { const c = coloniaPorId(e.coloniaId); return c ? textoColonia({ ...c, fuente: 'sepomex', validada: true }) : e.coloniaId; }
  return textoColonia({ nombre: e.manual.nombre, cp: e.manual.cp, fuente: 'manual', validada: false });
}

/**
 * Selector de colonia. `municipioClave`: el del folio (solo sus colonias); sin él, las de `municipios` (los que ve
 * el operador). Devuelve la elección con `alElegir` (null = quitar la elección).
 */
export function CapturaColonia({ municipioClave, municipios, valor, alElegir, etiqueta = 'Colonia' }: {
  municipioClave: string | null; municipios: readonly string[] | null; valor: ColoniaEntrada | null; alElegir: (e: ColoniaEntrada | null) => void; etiqueta?: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [manual, setManual] = useState(false);
  const [nombre, setNombre] = useState('');
  const [cp, setCp] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [error, setError] = useState('');
  const [gps, setGps] = useState('');
  const alcance = municipioClave ? [municipioClave] : municipios;
  const resultados = useMemo(() => buscarColonias(q, { municipios: alcance, limite: 10 }), [q, alcance]);
  const nombreMunicipio = (c: ColoniaCatalogo) => municipioPorClave(c.municipioClave)?.nombre ?? c.municipioClave;

  function usarGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGps('Este dispositivo no da su ubicación.'); return; }
    setGps('Buscando la ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setUbicacion(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`); setGps(''); },
      () => setGps('No se pudo leer el GPS. Pega las coordenadas o el enlace de Google Maps.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function guardarManual() {
    const coords = coordenadasDeTexto(ubicacion);
    if (nombre.trim().length < 2) { setError('Escribe el nombre de la colonia.'); return; }
    if (!/^76\d{3}$/.test(cp.trim())) { setError('El código postal de Querétaro tiene 5 dígitos y empieza con 76.'); return; }
    if (!coords) { setError('Pega las coordenadas (ej. 20.5888, -100.3899) o el enlace de Google Maps, o usa el GPS.'); return; }
    const entrada: ColoniaEntrada = { manual: { nombre: nombre.trim(), cp: cp.trim(), lat: coords.lat, lng: coords.lng } };
    const r = resolverColonia(entrada, municipioClave, { actor: 'consola', en: new Date().toISOString() });
    if ('error' in r) { setError(r.mensaje); return; }
    setError('');
    // Si ya estaba en el catálogo con ese CP, se usa la del catálogo.
    alElegir(r.colonia.id ? { coloniaId: r.colonia.id } : entrada);
    setManual(false);
  }

  if (valor) {
    return (
      <div className="c-colonia-elegida" data-testid="colonia-elegida">
        <span className="c-pequeno suave">{etiqueta}</span>
        <span className="c-linea"><strong>{textoEntrada(valor)}</strong>{'manual' in valor && <span className="c-chip c-chip-aviso">Manual</span>}</span>
        <button type="button" className="c-enlace" onClick={() => alElegir(null)} data-testid="colonia-cambiar">Cambiar</button>
      </div>
    );
  }
  return (
    <div className="c-colonia-captura" data-testid="colonia-captura">
      {!manual && (
        <>
          <label className="c-campo" htmlFor={`${id}-q`}>{etiqueta}</label>
          <input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código postal o nombre de la colonia" autoComplete="off" data-testid="colonia-buscar" aria-describedby={`${id}-ayuda`} />
          <span id={`${id}-ayuda`} className="suave c-pequeno">{municipioClave ? `Colonias de ${municipioPorClave(municipioClave)?.nombre ?? municipioClave} (catálogo SEPOMEX).` : 'Catálogo SEPOMEX de tus municipios.'}</span>
          {q.trim() && (
            <ul className="c-cnie-resultados" aria-label="Colonias encontradas" data-testid="colonia-resultados">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { alElegir({ coloniaId: c.id }); setQ(''); }} data-colonia={c.id}>
                    <span className="c-linea"><strong>{c.nombre}</strong><span className="c-mono">{`CP ${c.cp}`}</span></span>
                    <span className="suave c-pequeno">{`${c.tipo}${municipioClave ? '' : ` · ${nombreMunicipio(c)}`}`}</span>
                  </button>
                </li>
              ))}
              {!resultados.length && <li className="suave c-pequeno">{'Sin coincidencias en el catálogo.'}</li>}
            </ul>
          )}
          <button type="button" className="c-enlace" onClick={() => { setManual(true); setNombre(/^\d+$/.test(q.trim()) ? '' : q.trim()); setCp(/^76\d{3}$/.test(q.trim()) ? q.trim() : ''); setError(''); }} data-testid="colonia-agregar">
            {'¿No está en la lista? Agrégala'}
          </button>
        </>
      )}
      {manual && (
        <fieldset className="c-opciones c-colonia-manual" data-testid="colonia-manual">
          <legend>Agregar colonia (queda «manual, por validar»)</legend>
          <label className="c-campo">Nombre de la colonia<input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} data-testid="manual-nombre" /></label>
          <label className="c-campo">Código postal<input value={cp} onChange={(e) => setCp(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" placeholder="76…" data-testid="manual-cp" /></label>
          <label className="c-campo">Ubicación: coordenadas o enlace de Google Maps
            <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="20.5888, -100.3899" autoComplete="off" data-testid="manual-ubicacion" />
          </label>
          <div className="c-botones">
            <button type="button" className="c-boton-sec" onClick={usarGps}>Usar mi ubicación (GPS)</button>
          </div>
          {gps && <p className="suave c-pequeno" role="status">{gps}</p>}
          {coordenadasDeTexto(ubicacion) && <p className="suave c-pequeno">{`Se guardará en ${coordenadasDeTexto(ubicacion)!.lat}, ${coordenadasDeTexto(ubicacion)!.lng}.`}</p>}
          {error && <p className="c-error" role="alert">{error}</p>}
          <div className="c-botones">
            <button type="button" className="c-boton" onClick={guardarManual} data-testid="manual-usar">Usar esta colonia</button>
            <button type="button" className="c-enlace" onClick={() => { setManual(false); setError(''); }}>Volver al catálogo</button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** Colonia en el detalle del folio: se ve siempre; el operador la asigna o la corrige (con motivo opcional). */
export function ColoniaDelFolio({ r, municipios, ocupado, alGuardar }: {
  r: Reporte; municipios: readonly string[] | null; ocupado: boolean; alGuardar: (e: ColoniaEntrada, motivo: string) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [eleccion, setEleccion] = useState<ColoniaEntrada | null>(null);
  const [motivo, setMotivo] = useState('');
  const c = r.colonia ?? null;
  const correcciones = r.coloniaCorrecciones ?? [];
  return (
    <div className="c-colonia" data-testid="colonia-folio">
      <span className="c-linea">
        <strong>Colonia:</strong>
        <span data-testid="colonia-texto">{c ? `${c.nombre} · CP ${c.cp}` : 'Sin colonia'}</span>
        {c?.fuente === 'manual' && !c.validada && <span className="c-chip c-chip-aviso" data-testid="colonia-manual-chip">Manual, por validar</span>}
        {c?.metodo === 'referencia' && <span className="suave c-pequeno">(de la referencia)</span>}
      </span>
      {r.operable && !abierto && (
        <button type="button" className="c-enlace" onClick={() => setAbierto(true)} data-testid="colonia-editar">{c ? 'Cambiar colonia' : 'Asignar colonia'}</button>
      )}
      {abierto && (
        <div className="c-form-columna c-colonia-editar">
          <CapturaColonia municipioClave={r.municipioClave} municipios={municipios} valor={eleccion} alElegir={setEleccion} etiqueta={c ? 'Nueva colonia' : 'Colonia'} />
          {c && <label className="c-campo">Motivo del cambio (opcional)<input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ej. El reportante confirmó la colonia" /></label>}
          <div className="c-botones">
            <button type="button" className="c-boton-sec" disabled={!eleccion || ocupado} onClick={() => { if (eleccion) void alGuardar(eleccion, motivo).then((ok) => { if (ok) { setAbierto(false); setEleccion(null); setMotivo(''); } }); }} data-testid="colonia-guardar">Guardar colonia</button>
            <button type="button" className="c-enlace" onClick={() => { setAbierto(false); setEleccion(null); }}>Cancelar</button>
          </div>
        </div>
      )}
      {correcciones.length > 0 && (
        <ul className="c-lista c-pequeno suave" data-testid="colonia-historial">
          {correcciones.map((x) => <li key={x.en}>{`${hora(x.en)} · ${x.actor.replace(/^operador:/, '')} · ${x.de ?? 'Sin colonia'} → ${x.a}${x.motivo ? ` · motivo: “${x.motivo}”` : ''}`}</li>)}
        </ul>
      )}
    </div>
  );
}
