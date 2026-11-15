export const CLAVE_TEMA = 'poliaq.tema';

/** Se ejecuta antes de pintar (en <head>) para evitar el destello de tema equivocado. */
export const SCRIPT_TEMA = `(function(){try{var p=localStorage.getItem('${CLAVE_TEMA}')||'auto';var o=p==='oscuro'||(p==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-tema',o?'oscuro':'claro');}catch(e){}})();`;
