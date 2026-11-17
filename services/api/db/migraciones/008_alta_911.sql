-- 008: reportes que llegan por teléfono al 911 y se capturan en la consola (Mensaje 11).
--
-- Origen del folio, tipo de línea (celular o fijo) y operador que capturó la llamada. Solo se llena en
-- altas por 911; los folios de la app quedan en NULL (origen = app). No toca RLS ni permisos.
ALTER TABLE reporte ADD COLUMN alta jsonb;
