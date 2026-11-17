-- 007: respaldo estatal (CQ CIAS) y capacidad de los municipios.
--
-- 1) Cómo se enrutó cada folio al crearse: CAD de origen, motivo por el que lo atiende el CQ CIAS
--    (municipio sin conectar, sin capacidad, reporte anónimo por el 089, fuera de Querétaro) y canal.
--    Sin datos personales. Los folios anteriores quedan en NULL (origen = CAD actual).
ALTER TABLE reporte ADD COLUMN ruta jsonb;

-- 2) Disponibilidad de operador por CAD: sin operador disponible, los reportes nuevos del municipio
--    van al CQ CIAS. Un renglón por CAD; sin renglón = con operador.
CREATE TABLE disponibilidad_cad (
  cad_id        text PRIMARY KEY,
  sin_operador  boolean NOT NULL,
  nota          text,
  en            timestamptz NOT NULL,
  por           text NOT NULL
);
