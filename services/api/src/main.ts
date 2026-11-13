import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import { crearAppModule } from './app.module';
import { cargarConfig, type Config } from './config';

export async function crearApp(config: Config = cargarConfig()) {
  const app = await NestFactory.create<NestExpressApplication>(crearAppModule(config), { rawBody: true, logger: process.env.VITEST ? false : config.produccion ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug'] });
  // Contenido binario de evidencias (en producción se sube directo al almacén de objetos).
  app.use('/v1/reportes/:folio/evidencias/:id/contenido', raw({ type: () => true, limit: '200mb' }));
  app.enableCors({ origin: true });
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  const config = cargarConfig();
  void crearApp(config).then((app) => app.listen(config.puerto)).then(() => console.log(`Pol-IAQ API en el puerto ${config.puerto}`));
}
