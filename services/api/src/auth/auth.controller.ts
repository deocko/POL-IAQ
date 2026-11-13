import { Body, Controller, HttpCode, Inject, NotImplementedException, Post, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from '@pol-iaq/shared';
import { CONFIG, type Config } from '../config';
import { AlmacenService } from '../almacen/almacen.service';
import { ZodPipe } from '../comun/zod.pipe';
import { emitirToken } from './tokens';

/** Celular mexicano en formato E.164: +52 seguido de 10 dígitos. */
const TelefonoSchema = z.string().regex(/^\+52\d{10}$/, 'Usa el formato +52 y 10 dígitos');

const SolicitarOtpSchema = z.object({ telefono: TelefonoSchema });
const VerificarOtpSchema = z.object({
  telefono: TelefonoSchema,
  codigo: z.string().regex(/^\d{6}$/),
  nombre: z.string().min(2).max(120),
  /** Versiones que el ciudadano aceptó en pantalla; deben coincidir con las vigentes. */
  aceptaAvisoPrivacidad: z.string(),
  aceptaTerminos: z.string(),
});

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(CONFIG) private readonly config: Config, @Inject(AlmacenService) private readonly almacen: AlmacenService) {}

  @Post('otp')
  @HttpCode(202)
  solicitar(@Body(new ZodPipe(SolicitarOtpSchema)) body: z.infer<typeof SolicitarOtpSchema>) {
    if (this.config.produccion) {
      // TODO(fase 1): integrar proveedor de SMS y limitar intentos por número e IP.
      throw new NotImplementedException({ codigo: 'sms_no_configurado' });
    }
    return { enviado: true, telefono: body.telefono };
  }

  @Post('verificar')
  verificar(@Body(new ZodPipe(VerificarOtpSchema)) body: z.infer<typeof VerificarOtpSchema>) {
    if (this.config.produccion || body.codigo !== this.config.otpDesarrollo) {
      throw new UnauthorizedException({ codigo: 'otp_invalido' });
    }
    if (body.aceptaAvisoPrivacidad !== AVISO_PRIVACIDAD_VERSION || body.aceptaTerminos !== TERMINOS_VERSION) {
      throw new BadRequestException({ codigo: 'version_legal_desactualizada', avisoPrivacidadVersion: AVISO_PRIVACIDAD_VERSION, terminosVersion: TERMINOS_VERSION });
    }
    const ahora = new Date().toISOString();
    const existente = this.almacen.ciudadanoPorTelefono(body.telefono);
    const ciudadano = existente
      ? { ...existente, nombre: body.nombre, avisoPrivacidadVersion: body.aceptaAvisoPrivacidad, terminosVersion: body.aceptaTerminos, aceptadoEn: ahora }
      : { id: randomUUID(), telefono: body.telefono, nombre: body.nombre, confiabilidad: 1, avisoPrivacidadVersion: body.aceptaAvisoPrivacidad, terminosVersion: body.aceptaTerminos, aceptadoEn: ahora, suspendido: false };
    this.almacen.guardarCiudadano(ciudadano);
    this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'aceptacion_legal', detalle: { aviso: ciudadano.avisoPrivacidadVersion, terminos: ciudadano.terminosVersion } });
    return { token: emitirToken(this.config.secretoTokens, ciudadano.id), ciudadano: { id: ciudadano.id, nombre: ciudadano.nombre } };
  }
}
