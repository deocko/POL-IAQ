'use client';

import { useEffect, useState } from 'react';

export type PreferenciaTema = 'auto' | 'claro' | 'oscuro';
import { CLAVE_TEMA as CLAVE } from './tema-script';

function aplicar(p: PreferenciaTema) {
  const oscuro = p === 'oscuro' || (p === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-tema', oscuro ? 'oscuro' : 'claro');
}

/** Claro, oscuro o automático (según el teléfono). Se recuerda en este navegador. */
export function SelectorTema() {
  const [p, setP] = useState<PreferenciaTema>('auto');

  useEffect(() => {
    let guardada: PreferenciaTema = 'auto';
    try { guardada = (localStorage.getItem(CLAVE) as PreferenciaTema) || 'auto'; } catch { /* sin almacenamiento */ }
    setP(guardada);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiar = () => { try { if ((localStorage.getItem(CLAVE) || 'auto') === 'auto') aplicar('auto'); } catch { aplicar('auto'); } };
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  function elegir(n: PreferenciaTema) {
    setP(n);
    try { localStorage.setItem(CLAVE, n); } catch { /* sin almacenamiento */ }
    aplicar(n);
  }

  const opciones: [PreferenciaTema, string][] = [['claro', 'Claro'], ['oscuro', 'Oscuro'], ['auto', 'Auto']];
  return (
    <div className="tema" role="group" aria-label="Tema de colores">
      {opciones.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={p === v} onClick={() => elegir(v)}>{t}</button>
      ))}
    </div>
  );
}
