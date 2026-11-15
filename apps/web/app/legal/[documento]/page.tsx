import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { paraPublicar } from '../../../lib/legal';
import { Marca } from '../../../lib/marca';

/** Los textos legales viven en docs/legal del repositorio: una sola fuente. */
const DOCUMENTOS = {
  'aviso-privacidad': 'aviso-privacidad.md',
  'aviso-simplificado': 'aviso-simplificado.md',
  terminos: 'terminos.md',
} as const;

type Documento = keyof typeof DOCUMENTOS;

export function generateStaticParams() {
  return Object.keys(DOCUMENTOS).map((documento) => ({ documento }));
}

export const dynamicParams = false;

export default async function PaginaLegal({ params }: { params: Promise<{ documento: string }> }) {
  const { documento } = await params;
  if (!(documento in DOCUMENTOS)) notFound();
  const archivo = path.join(process.cwd(), '..', '..', 'docs', 'legal', DOCUMENTOS[documento as Documento]);
  const md = await readFile(archivo, 'utf8');
  const html = await marked.parse(paraPublicar(md, documento, process.env.NEXT_PUBLIC_BASE_PATH ?? ''));
  return (
    <main>
      <div className="legal-cabeza">
        <Link href="/" aria-label="POL-IAQ, ir al inicio"><Marca tam={36} /></Link>
        <Link href="/demo/">Volver a la app</Link>
      </div>
      <p className="legal-revision" role="note">Versión preliminar en revisión jurídica. La versión definitiva se publicará antes de que inicie el servicio y te pediremos aceptarla en la app.</p>
      <article className="legal" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
