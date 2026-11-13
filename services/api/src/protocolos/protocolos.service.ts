import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { CATALOGO_SEMILLA, PROTOCOLO_PROVISIONAL, ProtocoloSchema, type Protocolo } from '@pol-iaq/shared';
import { CONFIG, type Config } from '../config';

/**
 * Protocolo de atención vigente. Se carga al arrancar desde PROTOCOLO_ARCHIVO
 * (JSON) o, si no hay, se usa el provisional del paquete compartido.
 * Para publicar una versión nueva basta con cambiar el archivo y reiniciar;
 * los folios anteriores conservan la versión y el texto con que se levantaron.
 */
@Injectable()
export class ProtocolosService {
  private readonly log = new Logger('Protocolos');
  private readonly actual: Protocolo;

  constructor(@Inject(CONFIG) config: Config) {
    this.actual = config.protocoloArchivo ? ProtocolosService.leer(config.protocoloArchivo) : PROTOCOLO_PROVISIONAL;
    if (config.produccion && this.actual.estado !== 'vigente') {
      this.log.warn(`El protocolo ${this.actual.version} está en estado "${this.actual.estado}": valide su contenido contra el documento oficial antes de operar.`);
    }
    const faltan = CATALOGO_SEMILLA.filter((i) => !this.actual.incidentes.some((x) => x.incidenteId === i.id)).map((i) => i.id);
    if (faltan.length) this.log.warn(`El protocolo ${this.actual.version} no tiene preguntas para: ${faltan.join(', ')}`);
    this.log.log(`Protocolo de atención ${this.actual.version} (${this.actual.estado})`);
  }

  /** Lee y valida un protocolo en JSON; lanza un error claro si no cumple el esquema. */
  static leer(ruta: string): Protocolo {
    const r = ProtocoloSchema.safeParse(JSON.parse(readFileSync(ruta, 'utf8')));
    if (!r.success) throw new Error(`Protocolo inválido en ${ruta}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return r.data;
  }

  vigente(): Protocolo {
    return this.actual;
  }
}
