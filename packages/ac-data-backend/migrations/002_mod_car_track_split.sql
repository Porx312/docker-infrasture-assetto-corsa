-- Car / track split + artifact previews (run after 001)

CREATE TABLE IF NOT EXISTS mod_car_packages (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  ac_content_slug TEXT NOT NULL,
  preview_key TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_car_packages_ac_slug ON mod_car_packages(ac_content_slug);

CREATE TABLE IF NOT EXISTS mod_track_packages (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  ac_content_slug TEXT NOT NULL,
  preview_key TEXT,
  default_layout TEXT,
  ui_track_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_track_packages_ac_slug ON mod_track_packages(ac_content_slug);

ALTER TABLE mod_artifacts ADD COLUMN IF NOT EXISTS car_package_id UUID REFERENCES mod_car_packages(id) ON DELETE CASCADE;
ALTER TABLE mod_artifacts ADD COLUMN IF NOT EXISTS track_package_id UUID REFERENCES mod_track_packages(id) ON DELETE CASCADE;
ALTER TABLE mod_artifacts ADD COLUMN IF NOT EXISTS preview_storage_key TEXT;

-- Migrate packages from mod_packages (idempotent)
INSERT INTO mod_car_packages (id, slug, display_name, ac_content_slug, notes, created_at, updated_at)
SELECT id, slug, display_name, ac_content_slug, notes, created_at, updated_at
FROM mod_packages WHERE kind = 'car'
ON CONFLICT (id) DO NOTHING;

INSERT INTO mod_track_packages (id, slug, display_name, ac_content_slug, notes, created_at, updated_at)
SELECT id, slug, display_name, ac_content_slug, notes, created_at, updated_at
FROM mod_packages WHERE kind = 'track'
ON CONFLICT (id) DO NOTHING;

UPDATE mod_artifacts a
SET car_package_id = a.package_id
FROM mod_packages p
WHERE a.package_id = p.id AND p.kind = 'car' AND a.car_package_id IS NULL;

UPDATE mod_artifacts a
SET track_package_id = a.package_id
FROM mod_packages p
WHERE a.package_id = p.id AND p.kind = 'track' AND a.track_package_id IS NULL;

ALTER TABLE edge_artifact_assignments ADD COLUMN IF NOT EXISTS content_kind TEXT;
ALTER TABLE edge_artifact_assignments ADD COLUMN IF NOT EXISTS content_package_id UUID;

UPDATE edge_artifact_assignments ea
SET content_kind = p.kind, content_package_id = ea.package_id
FROM mod_packages p
WHERE ea.package_id = p.id AND ea.content_package_id IS NULL;

ALTER TABLE edge_artifact_inventory ADD COLUMN IF NOT EXISTS content_kind TEXT;
ALTER TABLE edge_artifact_inventory ADD COLUMN IF NOT EXISTS content_package_id UUID;

UPDATE edge_artifact_inventory inv
SET content_kind = p.kind, content_package_id = inv.package_id
FROM mod_packages p
WHERE inv.package_id = p.id AND inv.content_package_id IS NULL;

ALTER TABLE server_mod_requirements ADD COLUMN IF NOT EXISTS car_package_id UUID REFERENCES mod_car_packages(id) ON DELETE SET NULL;
ALTER TABLE server_mod_requirements ADD COLUMN IF NOT EXISTS track_package_id UUID REFERENCES mod_track_packages(id) ON DELETE SET NULL;

UPDATE server_mod_requirements r
SET car_package_id = r.package_id
FROM mod_packages p
WHERE r.package_id = p.id AND p.kind = 'car' AND r.car_package_id IS NULL;

UPDATE server_mod_requirements r
SET track_package_id = r.package_id
FROM mod_packages p
WHERE r.package_id = p.id AND p.kind = 'track' AND r.track_package_id IS NULL;
