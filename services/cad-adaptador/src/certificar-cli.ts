/**
 * pnpm --filter @pol-iaq/cad-adaptador certificar
 *
 * Variables: POLIAQ_URL (ambiente de pruebas), CAD_ID, SUP_USUARIO, SUP_CLAVE, OTP_PRUEBAS (000000),
 * DESTINO_TRANSFERENCIA (c5-queretaro), CAD_ACK_TIMEOUT_SEC (30), REGISTRAR (1 = guardar resultados).
 */
import { certificar } from './certificacion';

const env = process.env;
void certificar({
  polIaqUrl: (env.POLIAQ_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  cadId: env.CAD_ID ?? '',
  supervisor: { usuario: env.SUP_USUARIO ?? 'operador', clave: env.SUP_CLAVE ?? 'operador' },
  otp: env.OTP_PRUEBAS ?? '000000',
  destinoTransferencia: env.DESTINO_TRANSFERENCIA ?? 'c5-queretaro',
  esperaAcuseSeg: Number(env.CAD_ACK_TIMEOUT_SEC ?? 30),
  tiempoMaxSeg: Number(env.TIEMPO_CASO_SEG ?? 60),
  registrar: env.REGISTRAR === '1',
}).then((r) => {
  const fallidos = Object.entries(r).filter(([, x]) => !x.ok).map(([c]) => c);
  console.log(fallidos.length ? `Faltan: ${fallidos.join(', ')}` : 'Los 8 casos pasaron. El CAD puede pasar a producción.');
  process.exit(fallidos.length ? 1 : 0);
}).catch((e) => {
  console.error((e as Error).message);
  process.exit(2);
});
