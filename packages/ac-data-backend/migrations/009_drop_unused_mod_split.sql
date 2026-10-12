-- Drop abandoned car/track split tables, unused upload sessions, and dead columns.
-- Canonical catalog is unified mod_packages (+ mod_artifacts) only.

DROP TABLE IF EXISTS mod_upload_sessions;

-- Drop FK columns that pointed at the split tables (must precede DROP TABLE).
ALTER TABLE mod_artifacts DROP COLUMN IF EXISTS car_package_id;
ALTER TABLE mod_artifacts DROP COLUMN IF EXISTS track_package_id;
ALTER TABLE mod_artifacts DROP COLUMN IF EXISTS preview_storage_key;

ALTER TABLE edge_artifact_assignments DROP COLUMN IF EXISTS content_kind;
ALTER TABLE edge_artifact_assignments DROP COLUMN IF EXISTS content_package_id;

ALTER TABLE edge_artifact_inventory DROP COLUMN IF EXISTS content_kind;
ALTER TABLE edge_artifact_inventory DROP COLUMN IF EXISTS content_package_id;

ALTER TABLE server_mod_requirements DROP COLUMN IF EXISTS car_package_id;
ALTER TABLE server_mod_requirements DROP COLUMN IF EXISTS track_package_id;

DROP TABLE IF EXISTS mod_car_packages;
DROP TABLE IF EXISTS mod_track_packages;

ALTER TABLE fleet_edges DROP COLUMN IF EXISTS agent_token_hash;
