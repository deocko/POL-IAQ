import { Controller, Get, Inject } from '@nestjs/common';
import { AVISO_PRIVACIDAD_VERSION, CATALOGO_SEMILLA, MUNICIPIOS_PILOTO, TERMINOS_VERSION } from '@pol-iaq/shared';
import { ProtocolosService } from '../protocolos/protocolos.service';

@Controller('v1')
export class CatalogoController {
  constructor(@Inject(ProtocolosService) private readonly protocolos: ProtocolosService) {}

  /** Protocolo de atención vigente (preguntas, palabras clave, recomendaciones). Es público. */
  @Get('protocolo')
  protocolo() {
    return this.protocolos.vigente();
  }

  @Get('catalogo')
  catalogo() {
    return { version: 'semilla-dev', incidentes: CATALOGO_SEMILLA.map(({ codigoCnie: _c, ...publico }) => publico) };
  }

  @Get('municipios')
  municipios() {
    return MUNICIPIOS_PILOTO.map(({ claveInegi, nombre, piloto }) => ({ claveInegi, nombre, piloto }));
  }

  @Get('legal/versiones')
  versiones() {
    return { avisoPrivacidad: AVISO_PRIVACIDAD_VERSION, terminos: TERMINOS_VERSION };
  }

  @Get('salud')
  salud() {
    return { ok: true };
  }
}
