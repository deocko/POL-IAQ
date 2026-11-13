-- 003: botón de asistencia directa, cuestionario del protocolo en el folio y
-- perfil ciudadano con lugares guardados y escenarios de acceso rápido.

-- "Botón de pánico" pasa a llamarse "botón de asistencia directa".
ALTER TABLE reporte RENAME COLUMN es_panico TO asistencia_directa;

-- Escenario del perfil con el que se levantó el reporte (si aplica).
ALTER TABLE reporte ADD COLUMN escenario_id text;

-- Respuestas al protocolo de atención guardadas en texto, con la versión del
-- protocolo usada. Forma: { protocoloVersion, protocoloEstado, entradas: [...] }.
ALTER TABLE reporte ADD COLUMN cuestionario jsonb;
-- Canalización calculada con las respuestas: { prioridad, corporaciones, alertas }.
ALTER TABLE reporte ADD COLUMN canalizacion jsonb;

-- Perfil del ciudadano: lugares guardados (incluye datos sensibles opcionales,
-- como información médica) y escenarios. Se guarda como documento validado por
-- PerfilSchema en el API.
CREATE TABLE perfil_ciudadano (
  ciudadano_id   uuid PRIMARY KEY REFERENCES ciudadano(id),
  lugares        jsonb NOT NULL DEFAULT '[]',
  escenarios     jsonb NOT NULL DEFAULT '[]',
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
