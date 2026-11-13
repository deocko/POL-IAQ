-- 001: esquema inicial de Pol-IAQ para PostgreSQL 16 + PostGIS.
-- Las migraciones se aplican solas al arrancar el API (o con `pnpm db:migrar`).
-- No edites una migración ya aplicada: agrega una nueva.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE municipio (
  clave_inegi   char(3) PRIMARY KEY,
  nombre        text NOT NULL,
  piloto        boolean NOT NULL DEFAULT false,
  cad_id        text NOT NULL,
  -- Polígono oficial del Marco Geoestadístico de INEGI
  geocerca      geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX municipio_geocerca_idx ON municipio USING gist (geocerca);

CREATE TABLE catalogo_version (
  version       text PRIMARY KEY,
  fuente        text NOT NULL,            -- p. ej. "CNIE SESNSP v3.0"
  vigente_desde timestamptz NOT NULL
);

CREATE TABLE incidente_catalogo (
  id                    text NOT NULL,
  version               text NOT NULL REFERENCES catalogo_version(version),
  categoria             text NOT NULL,
  nombre_ciudadano      text NOT NULL,
  codigo_cnie           text,
  prioridad             text NOT NULL CHECK (prioridad IN ('alta','media','baja')),
  corporacion_sugerida  text NOT NULL,
  preguntas_guia        jsonb NOT NULL DEFAULT '[]',
  activo                boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id, version)
);

CREATE TABLE ciudadano (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono                  text NOT NULL UNIQUE,
  nombre                    text NOT NULL,
  confiabilidad             numeric(3,2) NOT NULL DEFAULT 1,
  suspendido                boolean NOT NULL DEFAULT false,
  creado_en                 timestamptz NOT NULL DEFAULT now()
);

-- Historial de aceptaciones legales (evidencia del consentimiento)
CREATE TABLE aceptacion_legal (
  id                        bigserial PRIMARY KEY,
  ciudadano_id              uuid NOT NULL REFERENCES ciudadano(id),
  aviso_privacidad_version  text NOT NULL,
  terminos_version          text NOT NULL,
  acepta_encuestas          boolean NOT NULL DEFAULT false,
  aceptado_en               timestamptz NOT NULL DEFAULT now(),
  ip                        inet,
  dispositivo               text
);

CREATE TABLE folio_consecutivo (
  clave_municipio char(3) NOT NULL,
  anio            int NOT NULL,
  ultimo          int NOT NULL DEFAULT 0,
  PRIMARY KEY (clave_municipio, anio)
);

CREATE TABLE reporte (
  folio                      text PRIMARY KEY CHECK (folio ~ '^QRO-\d{3}-\d{4}-\d{6}$'),
  ciudadano_id               uuid NOT NULL REFERENCES ciudadano(id),
  incidente_id               text NOT NULL,
  catalogo_version           text NOT NULL,
  codigo_cnie                text,
  prioridad                  text NOT NULL,
  ubicacion                  geography(Point, 4326) NOT NULL,
  precision_m                numeric,
  referencia                 text,
  municipio_clave            char(3),
  cad_id                     text NOT NULL,
  folio_cad                  text,
  descripcion                text,
  respuestas                 jsonb NOT NULL DEFAULT '{}',
  es_panico                  boolean NOT NULL DEFAULT false,
  ocultar_identidad_a_unidad boolean NOT NULL DEFAULT false,
  estado                     text NOT NULL,
  secuencia_salida           int NOT NULL DEFAULT 0,
  secuencia_entrada          int NOT NULL DEFAULT 0,
  creado_en                  timestamptz NOT NULL DEFAULT now(),
  actualizado_en             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reporte_ciudadano_idx ON reporte (ciudadano_id, creado_en DESC);
CREATE INDEX reporte_cad_estado_idx ON reporte (cad_id, estado);
CREATE INDEX reporte_ubicacion_idx ON reporte USING gist (ubicacion);

CREATE TABLE reporte_estado (
  id      bigserial PRIMARY KEY,
  folio   text NOT NULL REFERENCES reporte(folio),
  estado  text NOT NULL,
  nota    text,
  en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unidad_asignada (
  folio         text NOT NULL REFERENCES reporte(folio),
  unidad_id     text NOT NULL,
  corporacion   text NOT NULL,
  etiqueta      text NOT NULL,
  eta_minutos   numeric,
  posicion      geography(Point, 4326),
  rumbo         numeric,
  actualizado_en timestamptz,
  activa        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (folio, unidad_id)
);

CREATE TABLE evidencia (
  id               uuid PRIMARY KEY,
  folio            text NOT NULL REFERENCES reporte(folio),
  tipo             text NOT NULL CHECK (tipo IN ('foto','video','audio')),
  mime_type        text NOT NULL,
  bytes            bigint NOT NULL,
  sha256_declarado char(64) NOT NULL,
  sha256_servidor  char(64),
  estado           text NOT NULL CHECK (estado IN ('pendiente','verificada','rechazada')),
  objeto_clave     text,          -- clave en el almacén de objetos (WORM)
  capturado_en     timestamptz NOT NULL,
  recibido_en      timestamptz,
  ubicacion        geography(Point, 4326)
);

CREATE TABLE mensaje (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio         text NOT NULL REFERENCES reporte(folio),
  autor         text NOT NULL CHECK (autor IN ('ciudadano','operador','unidad')),
  nombre_autor  text,
  texto         text NOT NULL,
  en            timestamptz NOT NULL DEFAULT now()
);

-- Bandeja de salida hacia los CAD (patrón outbox)
CREATE TABLE bandeja_salida (
  evento_id     uuid PRIMARY KEY,
  cad_id        text NOT NULL,
  folio         text NOT NULL,
  tipo          text NOT NULL,
  cuerpo        jsonb NOT NULL,
  intentos      int NOT NULL DEFAULT 0,
  estado        text NOT NULL DEFAULT 'pendiente',
  siguiente_en  timestamptz NOT NULL DEFAULT now(),
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bandeja_pendientes_idx ON bandeja_salida (siguiente_en) WHERE estado = 'pendiente';

-- Idempotencia de eventos recibidos de los CAD
CREATE TABLE evento_recibido (
  evento_id   uuid PRIMARY KEY,
  cad_id      text NOT NULL,
  folio       text NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now()
);

-- Bitácora de auditoría: solo inserción
CREATE TABLE auditoria (
  id       bigserial PRIMARY KEY,
  en       timestamptz NOT NULL DEFAULT now(),
  actor    text NOT NULL,
  accion   text NOT NULL,
  folio    text,
  detalle  jsonb
);
REVOKE UPDATE, DELETE ON auditoria FROM PUBLIC;
