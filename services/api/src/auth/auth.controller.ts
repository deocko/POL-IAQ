import { Body, Controller, HttpCode, Inject, Post, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from '@pol-iaq/shared';
import { CONFIG, type Config } from '../config';
import { Almacen } from '../almacen/almacen';
import { ZodPipe } from '../comun/zod.pipe';
import { OtpService } from './otp.service';
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
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Almacen) private readonly almacen: Almacen,
    @Inject(OtpService) private readonly otp: OtpService,
  ) {}

  @Post('otp')
  @HttpCode(202)
  async solicitar(@Body(new ZodPipe(SolicitarOtpSchema)) body: z.infer<typeof SolicitarOtpSchema>) {
    // TODO(fase 2): limitar también por IP (en el balanceador o con Redis).
    await this.otp.enviar(body.telefono);
    return { enviado: true, telefono: body.telefono };
  }

  @Post('verificar')
  async verificar(@Body(new ZodPipe(VerificarOtpSchema)) body: z.infer<typeof VerificarOtpSchema>) {
    if (!(await this.otp.verificar(body.telefono, body.codigo))) {
      throw new UnauthorizedException({ codigo: 'otp_invalido' });
    }
    if (body.aceptaAvisoPrivacidad !== AVISO_PRIVACIDAD_VERSION || body.aceptaTerminos !== TERMINOS_VERSION) {
      throw new BadRequestException({ codigo: 'version_legal_desactualizada', avisoPrivacidadVersion: AVISO_PRIVACIDAD_VERSION, terminosVersion: TERMINOS_VERSION });
    }
    const ahora = new Date().toISOString();
    const existente = await this.almacen.ciudadanoPorTelefono(body.telefono);
    const ciudadano = existente
      ? { ...existente, nombre: body.nombre, avisoPrivacidadVersion: body.aceptaAvisoPrivacidad, terminosVersion: body.aceptaTerminos, aceptadoEn: ahora }
      : { id: randomUUID(), telefono: body.telefono, nombre: body.nombre, confiabilidad: 1, avisoPrivacidadVersion: body.aceptaAvisoPrivacidad, terminosVersion: body.aceptaTerminos, aceptadoEn: ahora, suspendido: false };
    await this.almacen.guardarCiudadano(ciudadano);
    await this.almacen.auditar({ actor: `ciudadano:${ciudadano.id}`, accion: 'aceptacion_legal', detalle: { aviso: ciudadano.avisoPrivacidadVersion, terminos: ciudadano.terminosVersion } });
    return { token: emitirToken(this.config.secretoTokens, ciudadano.id), ciudadano: { id: ciudadano.id, nombre: ciudadano.nombre } };
  }
}
