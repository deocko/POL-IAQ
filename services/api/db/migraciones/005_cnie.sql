-- 005: clasificación del Catálogo Nacional de Incidentes de Emergencia (CNIE V 3.0).
-- { version, tipo {codigo, nombre}, subtipo {codigo, nombre}, incidente {codigo, nombre} | null,
--   prioridad ALTA|MEDIA|BAJA | null, secundario {codigo, nombre} | null, origen }.
-- Los folios anteriores quedan con NULL y siguen siendo válidos.
ALTER TABLE reporte ADD COLUMN cnie jsonb;
CREATE INDEX reporte_cnie_subtipo_idx ON reporte ((cnie->'subtipo'->>'codigo')) WHERE cnie IS NOT NULL;
-- Correcciones del código por operador o CAD: [{ en, actor, de, a, secundario, motivo }]. También van a `auditoria`.
ALTER TABLE reporte ADD COLUMN cnie_correcciones jsonb NOT NULL DEFAULT '[]'::jsonb;
