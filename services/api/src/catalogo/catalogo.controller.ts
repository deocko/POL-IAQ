import { Controller, Get, Inject } from '@nestjs/common';
import {
  AVISO_PRIVACIDAD_VERSION, CATALOGO_SEMILLA, CNIE_FUENTE, CNIE_VERSION, CODIGOS_CNIE_RETIRADOS, INCIDENTES_CNIE, MUNICIPIOS_QRO, SUBTIPOS_CNIE, TERMINOS_VERSION, TIPOS_CNIE,
} from '@pol-iaq/shared';
import { ProtocolosService } from '../protocolos/protocolos.service';

@Controller('v1')
export class CatalogoController {
  constructor(@Inject(ProtocolosService) private readonly protocolos: ProtocolosService) {}

  /** Protocolo de atención vigente (preguntas, palabras clave, recomendaciones). Es público. */
  @Get('protocolo')
  protocolo() {
    return this.protocolos.vigente();
  }

  /** Opciones que ve el ciudadano. El código CNIE no se muestra en el flujo de reporte, pero viaja para el seguimiento. */
  @Get('catalogo')
  catalogo() {
    return { version: 'semilla-dev', cnie: CNIE_VERSION, incidentes: CATALOGO_SEMILLA };
  }

  /** Catálogo Nacional de Incidentes de Emergencia vigente: tipos, subtipos, incidentes y códigos retirados. Es público. */
  @Get('cnie')
  cnie() {
    return {
      version: CNIE_VERSION,
      fuente: CNIE_FUENTE,
      tipos: TIPOS_CNIE,
      subtipos: SUBTIPOS_CNIE,
      incidentes: INCIDENTES_CNIE.map((i) => ({ codigo: i.codigo, nombre: i.nombre, prioridad: i.prioridad, tipo: i.tipo.codigo, subtipo: i.subtipo.codigo })),
      retirados: CODIGOS_CNIE_RETIRADOS,
    };
  }

  @Get('municipios')
  municipios() {
    // `clave`: INEGI de 5 dígitos (22014). `claveInegi` (3 dígitos) se conserva por compatibilidad con v1.
    return MUNICIPIOS_QRO.map(({ clave, claveFolio, nombre, piloto, cadId }) => ({ clave, claveInegi: claveFolio, nombre, piloto, cadId }));
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
