-- 006: interconexión con los 18 municipios de Querétaro (Modo A con CAD, Modo B con la consola).
--
-- 1) municipio_clave pasa a la clave INEGI de 5 dígitos (22001–22018). Los folios anteriores
--    guardaban solo la parte municipal (014); se completan con la clave del estado (22).
--    El folio conserva su formato (QRO-014-2026-000001): folio_consecutivo sigue con 3 dígitos.
ALTER TABLE reporte ALTER COLUMN municipio_clave TYPE varchar(5);
UPDATE reporte SET municipio_clave = '22' || municipio_clave WHERE municipio_clave ~ '^\d{3}$';
ALTER TABLE reporte ADD CONSTRAINT reporte_municipio_clave_ck CHECK (municipio_clave IS NULL OR municipio_clave ~ '^22\d{3}$');
CREATE INDEX reporte_municipio_creado_idx ON reporte (municipio_clave, creado_en);
CREATE INDEX reporte_creado_idx ON reporte (creado_en);

-- 2) Alta de CAD (onboarding). El secreto HMAC va cifrado con AES-256-GCM (llave derivada de
--    TOKEN_SECRET); nunca se devuelve por el API.
CREATE TABLE registro_cad (
  cad_id              text PRIMARY KEY,
  nombre              text NOT NULL,
  clave               varchar(5) CHECK (clave IS NULL OR clave ~ '^22\d{3}$'),
  modo                text NOT NULL CHECK (modo IN ('webhook', 'consola')),
  estado              text NOT NULL CHECK (estado IN ('pruebas', 'activo', 'suspendido')),
  -- Polígono propio [[lng, lat], ...]; sin él se usa el de INEGI 2022.
  poligono            jsonb,
  webhook_url         text,
  secreto_cifrado     text,
  certificado_sha256  text,
  ips_permitidas      text[] NOT NULL DEFAULT '{}',
  contacto_tecnico    jsonb NOT NULL,
  casos_prueba        jsonb NOT NULL DEFAULT '{}'::jsonb,
  migracion           jsonb,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now()
);

-- 3) Unidades registradas desde la consola (Modo B) o reportadas por el CAD (Modo A).
CREATE TABLE unidad_registrada (
  unidad_id      text PRIMARY KEY,
  cad_id         text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('patrulla', 'motopatrulla', 'ambulancia', 'bomberos')),
  corporacion    text NOT NULL,
  etiqueta       text NOT NULL,
  activa         boolean NOT NULL DEFAULT true,
  base_lat       double precision,
  base_lng       double precision,
  registrada_en  timestamptz NOT NULL DEFAULT now(),
  registrada_por text NOT NULL
);
CREATE INDEX unidad_registrada_cad_idx ON unidad_registrada (cad_id);

-- 4) Cierre mensual del reporte al SESNSP. Un mes cerrado no se reescribe: no hay UPDATE en el
--    API y el disparador de abajo lo impide también a mano. Las correcciones van en el mes siguiente.
CREATE TABLE cierre_sesnsp (
  mes         char(7) PRIMARY KEY CHECK (mes ~ '^\d{4}-\d{2}$'),
  cerrado_en  timestamptz NOT NULL,
  cerrado_por text NOT NULL,
  filas       jsonb NOT NULL,
  ajustes     jsonb NOT NULL,
  foto        jsonb NOT NULL
);
CREATE FUNCTION cierre_sesnsp_congelado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El cierre SESNSP de % está congelado: las correcciones van en el mes siguiente', OLD.mes;
END $$;
CREATE TRIGGER cierre_sesnsp_sin_cambios BEFORE UPDATE OR DELETE ON cierre_sesnsp FOR EACH ROW EXECUTE FUNCTION cierre_sesnsp_congelado();
