-- Observatorio de Precios - Pedro Aguirre Cerda
-- Modelo relacional PostgreSQL + PostGIS (idempotente: se puede ejecutar varias veces)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS rol (
  id_rol SERIAL PRIMARY KEY,
  nombre VARCHAR(20) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS comercio (
  id_comercio SERIAL PRIMARY KEY,
  rut VARCHAR(12) UNIQUE NOT NULL,
  razon_social VARCHAR(120) NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('feria','almacen','supermercado','panaderia','farmacia','otro')),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sucursal (
  id_sucursal SERIAL PRIMARY KEY,
  id_comercio INT NOT NULL REFERENCES comercio ON DELETE RESTRICT,
  nombre VARCHAR(120) NOT NULL,
  direccion VARCHAR(160) NOT NULL,
  sector VARCHAR(40) NOT NULL,
  ubicacion GEOGRAPHY(Point, 4326) NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_sucursal_ubicacion ON sucursal USING GIST (ubicacion);
CREATE INDEX IF NOT EXISTS idx_sucursal_comercio ON sucursal (id_comercio);

CREATE TABLE IF NOT EXISTS usuario (
  id_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(120) UNIQUE NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  password_hash TEXT NOT NULL,
  id_rol INT NOT NULL REFERENCES rol,
  id_comercio INT REFERENCES comercio,
  id_sucursal INT REFERENCES sucursal,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categoria (
  id_categoria SERIAL PRIMARY KEY,
  nombre VARCHAR(60) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS producto (
  id_producto SERIAL PRIMARY KEY,
  id_categoria INT NOT NULL REFERENCES categoria,
  nombre VARCHAR(80) NOT NULL,
  marca VARCHAR(60),
  formato VARCHAR(40) NOT NULL,
  contenido NUMERIC(10,3) NOT NULL CHECK (contenido > 0),
  unidad_medida VARCHAR(5) NOT NULL CHECK (unidad_medida IN ('kg','g','l','ml','un')),
  clave VARCHAR(200) UNIQUE NOT NULL,        -- nombre|marca|formato normalizado: evita duplicados
  busqueda VARCHAR(200) NOT NULL,            -- texto normalizado (sin tildes) para buscar
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_producto_busqueda ON producto USING GIN (busqueda gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_producto_categoria ON producto (id_categoria);

CREATE TABLE IF NOT EXISTS sinonimo (
  id_sinonimo SERIAL PRIMARY KEY,
  termino VARCHAR(60) NOT NULL,
  id_producto INT NOT NULL REFERENCES producto ON DELETE CASCADE,
  UNIQUE (termino, id_producto)
);

CREATE TABLE IF NOT EXISTS carga_masiva (
  id_carga SERIAL PRIMARY KEY,
  id_usuario UUID NOT NULL REFERENCES usuario,
  archivo VARCHAR(120) NOT NULL,
  total INT NOT NULL,
  aceptadas INT NOT NULL,
  con_error INT NOT NULL,
  errores JSONB,
  creada TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS precio (
  id_precio BIGSERIAL PRIMARY KEY,
  id_producto INT NOT NULL REFERENCES producto,
  id_sucursal INT NOT NULL REFERENCES sucursal,
  id_usuario UUID NOT NULL REFERENCES usuario,
  id_carga INT REFERENCES carga_masiva,
  valor_normal INT NOT NULL CHECK (valor_normal > 0 AND valor_normal <= 1000000),
  valor_oferta INT CHECK (valor_oferta > 0),
  vigencia_desde DATE,
  vigencia_hasta DATE,
  condiciones VARCHAR(200),                  -- compra minima, medio de pago, membresia
  fuente VARCHAR(20) NOT NULL CHECK (fuente IN ('formulario','carga_masiva','terreno','api')),
  fecha_observacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado VARCHAR(10) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','retenido','inactivo','rechazado')),
  estado_oferta VARCHAR(10) NOT NULL DEFAULT 'ninguna' CHECK (estado_oferta IN ('ninguna','activa','vencida')),
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valor_oferta IS NULL OR valor_oferta < valor_normal),
  CHECK (valor_oferta IS NULL OR (vigencia_desde IS NOT NULL AND vigencia_hasta IS NOT NULL AND vigencia_hasta >= vigencia_desde))
);
-- Un solo precio vigente por producto y sucursal; los anteriores quedan como historial
CREATE UNIQUE INDEX IF NOT EXISTS uq_precio_vigente ON precio (id_producto, id_sucursal) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS idx_precio_producto_estado ON precio (id_producto, estado);
CREATE INDEX IF NOT EXISTS idx_precio_sucursal_estado ON precio (id_sucursal, estado);
CREATE INDEX IF NOT EXISTS idx_precio_observacion ON precio (fecha_observacion);
CREATE INDEX IF NOT EXISTS idx_precio_vigencia ON precio (vigencia_hasta) WHERE valor_oferta IS NOT NULL;

CREATE TABLE IF NOT EXISTS alerta (
  id_alerta SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('anomalia','carga_masiva','reporte')),
  id_precio BIGINT REFERENCES precio,
  id_sucursal INT REFERENCES sucursal,
  id_producto INT REFERENCES producto,
  detalle JSONB,
  estado VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  id_usuario UUID REFERENCES usuario,        -- quien genera el reporte ciudadano
  creada TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelta TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerta_estado ON alerta (estado, tipo);

CREATE TABLE IF NOT EXISTS log_auditoria (
  id_log BIGSERIAL PRIMARY KEY,
  id_usuario UUID,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  accion VARCHAR(20) NOT NULL,
  entidad VARCHAR(30) NOT NULL,
  id_entidad VARCHAR(40),
  valor_previo JSONB,
  valor_nuevo JSONB
);
CREATE INDEX IF NOT EXISTS idx_log_fecha ON log_auditoria (fecha DESC);

-- Bitacora inmutable: ni UPDATE, ni DELETE, ni TRUNCATE (ni siquiera la aplicacion puede alterarla)
CREATE OR REPLACE FUNCTION log_auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La bitacora de auditoria es de solo insercion';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_log_inmutable ON log_auditoria;
CREATE TRIGGER trg_log_inmutable BEFORE UPDATE OR DELETE ON log_auditoria
  FOR EACH ROW EXECUTE FUNCTION log_auditoria_inmutable();
DROP TRIGGER IF EXISTS trg_log_truncate ON log_auditoria;
CREATE TRIGGER trg_log_truncate BEFORE TRUNCATE ON log_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION log_auditoria_inmutable();

-- Precio vigente con la oferta efectiva (solo si esta dentro de su vigencia)
CREATE OR REPLACE VIEW v_precio_vigente AS
SELECT pr.*,
  (pr.valor_oferta IS NOT NULL AND pr.estado_oferta = 'activa'
     AND CURRENT_DATE BETWEEN pr.vigencia_desde AND pr.vigencia_hasta) AS oferta_activa,
  CASE WHEN pr.valor_oferta IS NOT NULL AND pr.estado_oferta = 'activa'
        AND CURRENT_DATE BETWEEN pr.vigencia_desde AND pr.vigencia_hasta
       THEN pr.valor_oferta ELSE pr.valor_normal END AS valor_final
FROM precio pr WHERE pr.estado = 'vigente';
