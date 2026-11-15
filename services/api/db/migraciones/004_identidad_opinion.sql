-- 004: reporte con seudónimo o anónimo, y calificación/queja después del cierre.

-- completa | seudonimo | anonimo (ver packages/shared/src/identidad.ts).
ALTER TABLE reporte ADD COLUMN identidad text NOT NULL DEFAULT 'completa'
  CHECK (identidad IN ('completa', 'seudonimo', 'anonimo'));
ALTER TABLE reporte ADD COLUMN alias text;

-- { calificacion 1-5, llegoUnidad si|tarde|no, comentario?, queja, en }.
ALTER TABLE reporte ADD COLUMN opinion jsonb;
CREATE INDEX reporte_queja_idx ON reporte (((opinion->>'queja')::boolean)) WHERE opinion IS NOT NULL;
