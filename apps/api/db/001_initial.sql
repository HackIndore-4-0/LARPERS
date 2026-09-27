CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buildings (
  id text PRIMARY KEY,
  source_osm_id text UNIQUE NOT NULL,
  name text NOT NULL,
  search_label text NOT NULL,
  footprint jsonb NOT NULL,
  mapped_level_count integer,
  approach jsonb,
  approach_approximate boolean NOT NULL DEFAULT false,
  ground_floor_lift_available boolean,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_features (
  id text PRIMARY KEY,
  source_osm_id text UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('osm', 'editor')),
  ordered_node_ids jsonb NOT NULL,
  geometry jsonb NOT NULL,
  classification text NOT NULL CHECK (classification IN ('main', 'shortcut')),
  level_key text,
  surface text,
  slope_percent double precision,
  width_meters double precision,
  stairs text NOT NULL DEFAULT 'unknown' CHECK (stairs IN ('yes', 'no', 'unknown')),
  wheelchair_access text NOT NULL DEFAULT 'unknown' CHECK (wheelchair_access IN ('yes', 'no', 'unknown')),
  confidence text NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('osm_tag', 'editor_observation', 'condition_report', 'unknown')),
  osm_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_annotations (
  route_feature_id text PRIMARY KEY REFERENCES route_features(id) ON DELETE CASCADE,
  public_note text,
  blocked boolean NOT NULL DEFAULT false,
  block_reason text,
  expires_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocked_reason_required CHECK (NOT blocked OR (block_reason IS NOT NULL AND length(trim(block_reason)) > 0))
);

CREATE TABLE IF NOT EXISTS floor_layouts (
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor_number integer NOT NULL,
  layout jsonb NOT NULL,
  canvas_width integer NOT NULL,
  canvas_height integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_id, floor_number)
);

CREATE TABLE IF NOT EXISTS public_points (
  id text PRIMARY KEY,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visitor_messages (
  id text PRIMARY KEY,
  original_text text NOT NULL,
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  status text NOT NULL DEFAULT 'incoming' CHECK (status IN ('incoming', 'saved', 'addressed')),
  editor_annotation text,
  cloudinary_public_id text,
  cloudinary_format text,
  cloudinary_delivery_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_cleanup_jobs (
  id text PRIMARY KEY,
  cloudinary_public_id text NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS map_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO map_revision(singleton, revision) VALUES(true, 1)
ON CONFLICT(singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS buildings_search_label_idx ON buildings(search_label);
CREATE INDEX IF NOT EXISTS visitor_messages_status_created_idx ON visitor_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS route_annotations_expiry_idx ON route_annotations(expires_at) WHERE expires_at IS NOT NULL;

