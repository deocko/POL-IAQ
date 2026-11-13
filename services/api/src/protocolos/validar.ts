/**
 * Valida un archivo de protocolo antes de publicarlo:
 *   pnpm --filter @pol-iaq/api validar-protocolo ../../docs/protocolos/<version>.json
 */
import 'reflect-metadata';
import { CATALOGO_SEMILLA } from '@pol-iaq/shared';
import { ProtocolosService } from './protocolos.service';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: validar-protocolo <archivo.json>');
  process.exit(2);
}
try {
  const p = ProtocolosService.leer(ruta);
  const faltan = CATALOGO_SEMILLA.filter((i) => !p.incidentes.some((x) => x.incidenteId === i.id)).map((i) => i.id);
  const preguntas = p.preguntasGenerales.length + p.incidentes.reduce((n, i) => n + i.preguntas.length, 0);
  console.log(`OK: protocolo ${p.version} (${p.estado}), ${p.incidentes.length} incidentes, ${preguntas} preguntas.`);
  if (faltan.length) console.warn(`Aviso: sin preguntas para ${faltan.join(', ')}`);
  if (p.estado !== 'vigente') console.warn(`Aviso: estado "${p.estado}". Solo "vigente" debe usarse en operación real.`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
