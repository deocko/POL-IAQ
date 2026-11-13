import { Logger } from '@nestjs/common';
import type { Config } from '../config';

/**
 * Proveedor de SMS. Para agregar otro (AWS SNS, Infobip, un agregador
 * mexicano…) basta con implementar `enviar` y registrarlo en `crearProveedorSms`.
 */
export abstract class ProveedorSms {
  abstract readonly nombre: string;
  /** `telefono` en E.164 (+52…). Lanza un error si el proveedor lo rechaza. */
  abstract enviar(telefono: string, texto: string): Promise<void>;
}

/** No envía nada: guarda los mensajes y los muestra en el log. Para desarrollo y pruebas. */
export class SmsSimulado extends ProveedorSms {
  readonly nombre = 'simulado';
  private readonly log = new Logger('SMS simulado');
  readonly enviados: { telefono: string; texto: string; en: string }[] = [];

  async enviar(telefono: string, texto: string) {
    this.enviados.push({ telefono, texto, en: new Date().toISOString() });
    this.log.log(`→ ${telefono}: ${texto}`);
  }
}

/** Twilio Programmable Messaging por su API REST (sin SDK). */
export class SmsTwilio extends ProveedorSms {
  readonly nombre = 'twilio';
  constructor(private readonly cfg: { accountSid: string; authToken: string; remitente: string }) {
    super();
  }

  async enviar(telefono: string, texto: string) {
    const remitente: Record<string, string> = this.cfg.remitente.startsWith('MG') ? { MessagingServiceSid: this.cfg.remitente } : { From: this.cfg.remitente };
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: telefono, Body: texto, ...remitente }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const cuerpo = (await resp.json().catch(() => ({}))) as { code?: number; message?: string };
      throw new Error(`Twilio respondió ${resp.status}${cuerpo.code ? ` (${cuerpo.code})` : ''}: ${cuerpo.message ?? 'sin detalle'}`);
    }
  }
}

export function crearProveedorSms(config: Config): ProveedorSms {
  const sms = config.sms;
  switch (sms.proveedor) {
    case 'twilio':
      if (!sms.twilio) throw new Error('SMS_PROVIDER=twilio requiere TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM');
      return new SmsTwilio(sms.twilio);
    case 'simulado':
      return new SmsSimulado();
  }
}
