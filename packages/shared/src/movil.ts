/**
 * Punto de entrada seguro para apps (React Native / navegador): no importa
 * módulos de Node como `node:crypto`.
 */
export * from './estados';
export * from './legal';
export * from './folio';
export type { IncidenteCatalogo, Prioridad, Corporacion, CategoriaIncidente } from './catalogo';
export * from './protocolos';
export * from './protocolo-provisional';
export * from './escenarios';
export { CATALOGO_SEMILLA, incidentePorId } from './catalogo';
export * from './cnie';
export * from './cnie-mapeo';
export * from './municipios';
export * from './geo';
export * from './despacho';
export * from './tiempos';
export * from './identidad';
export * from './cola';
export * from './unidades-ejemplo';
