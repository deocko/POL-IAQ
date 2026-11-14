import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Almacen } from './almacen/almacen';
import { AlmacenMemoria } from './almacen/almacen-memoria';
import { AlmacenPostgres } from './almacen/almacen-postgres';
import { AuthController } from './auth/auth.controller';
import { CiudadanoGuard } from './auth/auth.guard';
import { OtpService } from './auth/otp.service';
import { CadController } from './cad/cad.controller';
import { EventosCadService } from './cad/eventos-cad.service';
import { DespachadorCadService } from './cad/despachador.service';
import { CatalogoController } from './catalogo/catalogo.controller';
import { BusService } from './comun/bus.service';
import { CONFIG, cargarConfig, type Config } from './config';
import { OperacionGateway } from './operador/operacion.gateway';
import { OperadorController } from './operador/operador.controller';
import { OperadorGuard } from './operador/operador.guard';
import { PerfilController } from './perfil/perfil.controller';
import { ProtocolosService } from './protocolos/protocolos.service';
import { ReportesController } from './reportes/reportes.controller';
import { ReportesService } from './reportes/reportes.service';
import { SeguimientoGateway } from './seguimiento/seguimiento.gateway';
import { AvisosSmsService } from './sms/avisos-sms.service';
import { ProveedorSms, crearProveedorSms } from './sms/sms';

/** PostgreSQL si hay `DATABASE_URL`; si no, memoria (solo fuera de producción, lo valida la config). */
export async function crearAlmacen(config: Config): Promise<Almacen> {
  if (!config.databaseUrl) return new AlmacenMemoria();
  return AlmacenPostgres.conectar(config.databaseUrl, { migrar: config.migrarAlIniciar });
}

export function crearAppModule(config: Config = cargarConfig(), opciones: { almacen?: Almacen; sms?: ProveedorSms } = {}) {
  @Module({
    controllers: [AuthController, CatalogoController, ReportesController, PerfilController, CadController, OperadorController],
    providers: [
      { provide: CONFIG, useValue: config },
      opciones.almacen ? { provide: Almacen, useValue: opciones.almacen } : { provide: Almacen, useFactory: () => crearAlmacen(config) },
      { provide: ProveedorSms, useValue: opciones.sms ?? crearProveedorSms(config) },
      AvisosSmsService,
      OtpService,
      BusService,
      DespachadorCadService,
      ProtocolosService,
      ReportesService,
      EventosCadService,
      CiudadanoGuard,
      OperadorGuard,
      SeguimientoGateway,
      OperacionGateway,
    ],
  })
  class AppModule implements OnApplicationShutdown {
    constructor(@Inject(Almacen) readonly almacen: Almacen) {}
    async onApplicationShutdown() {
      // Si el almacén lo pasó quien llama (pruebas), lo cierra quien llama.
      if (!opciones.almacen) await this.almacen.cerrar();
    }
  }
  return AppModule;
}
