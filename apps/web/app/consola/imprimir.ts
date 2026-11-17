/**
 * «Imprimir o guardar PDF» sin bloquear la consola.
 *
 * `window.print()` en la pestaña de la consola detiene su JavaScript mientras el diálogo está abierto
 * (el reloj se congela y los clics no responden), y en algunos entornos la pestaña no se recupera.
 * Por eso el reporte se copia a una página aparte (solo el contenido del reporte, con los estilos de la
 * consola en tema claro), que se abre en otra pestaña sin `opener` (otro proceso del navegador) y ahí
 * abre el diálogo de impresión. La consola sigue respondiendo pase lo que pase con el diálogo.
 */
const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Arma el HTML de la página de impresión a partir de la sección del reporte. Exportado para pruebas. */
export function paginaDeImpresion(seccion: HTMLElement, titulo: string, doc: Document = document): string {
  const copia = seccion.cloneNode(true) as HTMLElement;
  // Fuera lo que es de la app (botones, filtros) y se muestra el encabezado que solo va impreso.
  copia.querySelectorAll('.c-no-imprimir, button, select, input').forEach((n) => n.remove());
  copia.querySelectorAll('.c-solo-imprimir').forEach((n) => n.classList.remove('c-solo-imprimir'));
  copia.querySelectorAll('.c-tabla-desliza').forEach((n) => n.classList.add('c-tabla-impresa'));
  const base = doc.baseURI;
  const estilos = [
    ...[...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${escapar(new URL(l.getAttribute('href') ?? '', base).href)}">`),
    ...[...doc.querySelectorAll('style')].map((s) => `<style>${s.textContent ?? ''}</style>`),
  ].join('\n');
  const generado = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  return `<!doctype html>
<html lang="es" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
${estilos}
<style>
  html, body { background: #fff !important; color: #000 !important; }
  body { margin: 0; padding: 24px; font-size: 14px; }
  .imp-barra { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding: 12px; border: 1px solid #999; border-radius: 8px; }
  .imp-barra button { font: inherit; font-weight: 700; padding: 8px 16px; border-radius: 8px; border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; cursor: pointer; }
  .imp-pie { margin-top: 16px; font-size: 12px; color: #444; }
  .c-panel { max-width: none !important; padding: 0 !important; box-shadow: none !important; border: 0 !important; }
  .c-tabla-impresa { overflow: visible !important; }
  .c-tabla-impresa .c-tiempos { min-width: 0 !important; }
  .c-tarjeta { break-inside: avoid; }
  @page { margin: 14mm; }
  @media print { .imp-barra { display: none !important; } body { padding: 0; } }
</style>
</head>
<body>
<div class="imp-barra" role="region" aria-label="Impresión">
  <button type="button" onclick="window.print()">Imprimir o guardar PDF</button>
  <span>En el diálogo elige «Guardar como PDF» para obtener el archivo. Puedes cerrar esta pestaña al terminar: la consola sigue abierta en la otra.</span>
</div>
<main>${copia.outerHTML}</main>
<p class="imp-pie">POL-IAQ · generado el ${escapar(generado)} (hora de Querétaro) · sin datos personales</p>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>
</body>
</html>`;
}

/**
 * Abre el reporte en una pestaña aparte para imprimirlo o guardarlo como PDF. Devuelve la URL (blob)
 * por si el navegador bloquea la pestaña nueva y hay que ofrecer el enlace.
 */
export function imprimirReporte(seccion: HTMLElement, titulo: string): string {
  const url = URL.createObjectURL(new Blob([paginaDeImpresion(seccion, titulo)], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  // Sin opener: la pestaña nueva no comparte proceso con la consola, así el diálogo no la congela.
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // La pestaña nueva ya cargó el blob; se libera después con margen.
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return url;
}
