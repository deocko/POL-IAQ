import { Inject, Injectable, Logger } from '@nestjs/common';
import { Almacen } from '../almacen/almacen';
import type { Reporte } from '../almacen/modelos';
import { CONFIG, type Config } from '../config';
import { ProveedorSms } from './sms';

/**
 * Avisos por SMS al ciudadano en los momentos clave del reporte. Sirven de
 * respaldo cuando la app está cerrada o sin datos; el seguimiento detallado
 * sigue siendo en la app. Nunca bloquean ni hacen fallar el flujo del CAD.
 */
@Injectable()
export class AvisosSmsService {
  private readonly log = new Logger('AvisosSms');

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(ProveedorSms) private readonly sms: ProveedorSms,
  ) {}

  unidadAsignada(r: Reporte) {
    if (!r.unidad) return;
    const eta = r.unidad.etaMinutos !== undefined ? ` Llega en unos ${Math.round(r.unidad.etaMinutos)} min.` : '';
    this.avisar(r, `Pol-IAQ: tu reporte ${r.folio} ya tiene unidad asignada (${r.unidad.etiqueta}).${eta} Síguela en la app.`);
  }

  transferido(r: Reporte) {
    this.avisar(r, `Pol-IAQ: tu reporte ${r.folio} pasó a otra corporación. Conserva el mismo folio para darle seguimiento.`);
  }

  private avisar(r: Reporte, texto: string) {
    if (!this.config.sms.avisos) return;
    this.almacen.aparte(() => {
      void (async () => {
        const c = await this.almacen.ciudadano(r.ciudadanoId);
        if (!c) return;
        await this.sms.enviar(c.telefono, texto);
      })().catch((err) => this.log.warn(`No se envió el aviso de ${r.folio}: ${(err as Error).message}`));
    });
  }
}
