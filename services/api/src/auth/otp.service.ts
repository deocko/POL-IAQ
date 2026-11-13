import { HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Almacen } from '../almacen/almacen';
import { CONFIG, type Config } from '../config';
import { ProveedorSms } from '../sms/sms';

const VIGENCIA_MS = 5 * 60_000;
const VENTANA_MS = 15 * 60_000;
const MAX_POR_VENTANA = 3;
const MAX_INTENTOS = 5;

/**
 * Códigos de verificación por SMS: 6 dígitos, 5 minutos de vigencia, hasta 3
 * envíos por número cada 15 minutos y 5 intentos por código. Solo se guarda
 * el HMAC del código, nunca el código.
 */
@Injectable()
export class OtpService {
  private readonly log = new Logger('Otp');

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(ProveedorSms) private readonly sms: ProveedorSms,
  ) {}

  private hash(telefono: string, codigo: string) {
    return createHmac('sha256', this.config.secretoTokens).update(`otp:${telefono}:${codigo}`).digest('hex');
  }

  async enviar(telefono: string) {
    const desde = new Date(Date.now() - VENTANA_MS).toISOString();
    if ((await this.almacen.contarOtpsDesde(telefono, desde)) >= MAX_POR_VENTANA) {
      throw new HttpException({ codigo: 'limite_otp', mensaje: 'Pediste demasiados códigos. Espera unos minutos. Si es una emergencia, llama al 911.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const codigo = this.config.otpDesarrollo || String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.almacen.registrarOtp({ telefono, codigoHash: this.hash(telefono, codigo), expiraEn: new Date(Date.now() + VIGENCIA_MS).toISOString() });
    try {
      await this.sms.enviar(telefono, `Pol-IAQ: tu código es ${codigo}. Vence en 5 minutos. No lo compartas con nadie.`);
    } catch (err) {
      this.log.error(`No se pudo enviar el código por ${this.sms.nombre}: ${(err as Error).message}`);
      throw new ServiceUnavailableException({ codigo: 'sms_no_enviado', mensaje: 'No pudimos enviar el SMS. Intenta de nuevo. Si es una emergencia, llama al 911.' });
    }
  }

  /** true si el código es válido; lo marca como usado. */
  async verificar(telefono: string, codigo: string): Promise<boolean> {
    if (this.config.otpDesarrollo && codigo === this.config.otpDesarrollo) return true;
    const otp = await this.almacen.ultimoOtp(telefono);
    if (!otp || otp.usado || otp.intentos >= MAX_INTENTOS || otp.expiraEn < new Date().toISOString()) return false;
    const ok = timingSafeEqual(Buffer.from(otp.codigoHash), Buffer.from(this.hash(telefono, codigo)));
    await this.almacen.actualizarOtp(otp.id, { intentos: otp.intentos + 1, usado: ok });
    return ok;
  }
}
