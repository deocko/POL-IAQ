-- 002: lo que el API necesita para dejar el almacén en memoria.

-- Corporación sugerida por el catálogo al crear el reporte.
ALTER TABLE reporte ADD COLUMN corporacion_sugerida text NOT NULL DEFAULT 'policia_municipal';
ALTER TABLE reporte ALTER COLUMN corporacion_sugerida DROP DEFAULT;
-- Mientras el catálogo viva en el código (packages/shared), su versión es la que publica GET /v1/catalogo.
ALTER TABLE reporte ALTER COLUMN catalogo_version SET DEFAULT 'semilla-dev';

CREATE INDEX reporte_estado_folio_idx ON reporte_estado (folio, id);
CREATE INDEX mensaje_folio_idx ON mensaje (folio, en);
CREATE INDEX evidencia_folio_idx ON evidencia (folio);
CREATE INDEX aceptacion_legal_ciudadano_idx ON aceptacion_legal (ciudadano_id, aceptado_en DESC);
CREATE INDEX auditoria_folio_idx ON auditoria (folio, en);

-- Solo una unidad activa por folio.
CREATE UNIQUE INDEX unidad_asignada_activa_idx ON unidad_asignada (folio) WHERE activa;

-- Contenido de la evidencia. Provisional: en producción va a un almacén de
-- objetos con WORM (evidencia.objeto_clave) y esta tabla queda vacía.
CREATE TABLE evidencia_contenido (
  evidencia_id uuid PRIMARY KEY REFERENCES evidencia(id),
  datos        bytea NOT NULL
);

-- Códigos de verificación por SMS. Solo se guarda el HMAC del código.
CREATE TABLE otp (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono    text NOT NULL,
  codigo_hash char(64) NOT NULL,
  expira_en   timestamptz NOT NULL,
  intentos    int NOT NULL DEFAULT 0,
  usado       boolean NOT NULL DEFAULT false,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_telefono_idx ON otp (telefono, creado_en DESC);
