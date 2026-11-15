/**
 * Versión del build de la demo y comprobación de caché.
 *
 * GitHub Pages sirve el HTML con caché de unos minutos, así que justo después de publicar un navegador
 * puede pintar la página de un build anterior. Este script va en el <head> de cada página: pide
 * /version.json sin caché y, si la versión publicada no es la de esta página, recarga una sola vez con
 * `?v=<versión>` (una URL nueva que no está en la caché). Si falla la red, no hace nada.
 */
export const VERSION = process.env.NEXT_PUBLIC_VERSION ?? 'dev';
export const VERSION_COMMIT = process.env.NEXT_PUBLIC_VERSION_COMMIT ?? 'dev';
export const VERSION_FECHA = process.env.NEXT_PUBLIC_VERSION_FECHA ?? '';

export function scriptVersion(base: string, version: string): string {
  if (version === 'dev') return '';
  return `(function(){try{var a=${JSON.stringify(version)};fetch(${JSON.stringify(`${base}/version.json`)},{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(v){if(!v||!v.id||v.id===a)return;var k='poliaq.recarga.'+v.id;if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');var u=new URL(location.href);u.searchParams.set('v',v.id);location.replace(u.toString());}).catch(function(){});}catch(e){}})();`;
}

/** "Versión 6e5dd9d · 15/11/2026 14:40" (hora de Querétaro) o "Versión de desarrollo". */
export function etiquetaVersion(): string {
  if (VERSION === 'dev' || !VERSION_FECHA) return 'Versión de desarrollo';
  const fecha = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(VERSION_FECHA)).replace(/[  ]/g, ' ').replace(',', '');
  return `Versión ${VERSION_COMMIT} · ${fecha}`;
}
