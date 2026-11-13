import { Module } from '@nestjs/common';
import { AlmacenService } from './almacen/almacen.service';
import { AuthController } from './auth/auth.controller';
import { CiudadanoGuard } from './auth/auth.guard';
import { CadController } from './cad/cad.controller';
import { DespachadorCadService } from './cad/despachador.service';
import { CatalogoController } from './catalogo/catalogo.controller';
import { BusService } from './comun/bus.service';
import { CONFIG, cargarConfig, type Config } from './config';
import { ReportesController } from './reportes/reportes.controller';
import { ReportesService } from './reportes/reportes.service';
import { SeguimientoGateway } from './seguimiento/seguimiento.gateway';

export function crearAppModule(config: Config = cargarConfig()) {
  @Module({
    controllers: [AuthController, CatalogoController, ReportesController, CadController],
    providers: [
      { provide: CONFIG, useValue: config },
      AlmacenService,
      BusService,
      DespachadorCadService,
      ReportesService,
      CiudadanoGuard,
      SeguimientoGateway,
    ],
  })
  class AppModule {}
  return AppModule;
}
