export { EventoHaciaCadSchema, firmar, verificarFirma } from '@pol-iaq/shared';
export interface CadConfigLike {
  webhookUrl: string;
  secreto: string;
}
