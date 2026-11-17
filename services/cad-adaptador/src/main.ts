import { crearAdaptador } from './adaptador';
import { cargarConfig } from './config';

const config = cargarConfig();
const a = crearAdaptador(config);
a.servidor.listen(config.puerto, () => console.log(`Adaptador POL-IAQ (${config.despliegue}) en :${config.puerto} para ${Object.keys(config.tenants).join(', ')} → ${config.polIaqUrl}`));
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => void a.cerrar().then(() => process.exit(0)));
