export { EventoHaciaCadSchema, etiquetaCnie, firmar, validarCodigoCnie, verificarFirma } from '@pol-iaq/shared';
export interface CadConfigLike {
  webhookUrl: string;
  secreto: string;
}
