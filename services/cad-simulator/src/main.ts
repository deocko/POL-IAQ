/**
 * CAD simulado (ver simulador.ts).
 *
 * Modo `contrato` (por omisión): SIM_PORT (4000), POLIAQ_URL (http://localhost:3000) y CADS_JSON
 * (el mismo JSON que usa el API, para conocer el secreto de cada CAD).
 *
 * Modo `nativo` (SIM_MODO=nativo), detrás de services/cad-adaptador: ADAPTADOR_URL, SIM_CAD_ID,
 * SIM_TOKEN_ADAPTADOR (el tokenDesdeCad del adaptador) y SIM_TOKEN_ENTRADA (el tokenHaciaCad).
 */
import { crearSimulador, type UnidadSimulada } from './simulador';

const PORT = Number(process.env.SIM_PORT ?? 4000);
const modo = process.env.SIM_MODO === 'nativo' ? 'nativo' : 'contrato';
const sim = crearSimulador({
  modo,
  pasoMs: Number(process.env.SIM_STEP_MS ?? 3000),
  polIaqUrl: process.env.POLIAQ_URL ?? 'http://localhost:3000',
  cads: JSON.parse(process.env.CADS_JSON ?? '{}') as Record<string, { secreto: string }>,
  adaptadorUrl: process.env.ADAPTADOR_URL ?? 'http://localhost:4100',
  cadId: process.env.SIM_CAD_ID,
  tokenHaciaAdaptador: process.env.SIM_TOKEN_ADAPTADOR,
  tokenEntrada: process.env.SIM_TOKEN_ENTRADA || undefined,
  unidades: process.env.SIM_UNIDADES_JSON ? (JSON.parse(process.env.SIM_UNIDADES_JSON) as UnidadSimulada[]) : undefined,
});
sim.servidor.listen(PORT, () => console.log(`CAD simulado (${modo}) escuchando en :${PORT}`));
