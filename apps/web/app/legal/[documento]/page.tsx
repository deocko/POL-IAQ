import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { marked } from 'marked';

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
  const html = await marked.parse(md.replace(/\]\(([\w-]+)\.md\)/g, '](/legal/$1)'));
  return <main dangerouslySetInnerHTML={{ __html: html }} />;
}
