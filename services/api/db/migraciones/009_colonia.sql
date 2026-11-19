-- 009: colonia del folio (filtros de la consola).
--
-- `colonia`: la del catálogo SEPOMEX (id, nombre, CP, tipo) o una alta manual del operador con CP y ubicación,
-- marcada «manual» y sin validar. NULL = sin colonia. `colonia_correcciones`: cambios hechos desde la consola.
-- No toca RLS ni permisos.
ALTER TABLE reporte ADD COLUMN colonia jsonb;
ALTER TABLE reporte ADD COLUMN colonia_correcciones jsonb NOT NULL DEFAULT '[]'::jsonb;
