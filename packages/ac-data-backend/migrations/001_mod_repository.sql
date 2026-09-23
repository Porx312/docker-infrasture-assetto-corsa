-- Mod repository + distribution (run once: psql $DATABASE_URL -f migrations/001_mod_repository.sql)

CREATE TABLE IF NOT EXISTS mod_packages (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('car', 'track', 'weather', 'misc')),
  ac_content_slug TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_artifacts (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES mod_packages(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (package_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_mod_artifacts_package ON mod_artifacts(package_id);
CREATE INDEX IF NOT EXISTS idx_mod_artifacts_sha256 ON mod_artifacts(sha256);

CREATE TABLE IF NOT EXISTS fleet_edges (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  agent_token_hash TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  disk_free_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edge_artifact_assignments (
  edge_id TEXT NOT NULL REFERENCES fleet_edges(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES mod_artifacts(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES mod_packages(id) ON DELETE CASCADE,
  desired_state TEXT NOT NULL DEFAULT 'present' CHECK (desired_state IN ('present', 'absent')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (edge_id, package_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_assignments_artifact ON edge_artifact_assignments(artifact_id);

CREATE TABLE IF NOT EXISTS edge_artifact_inventory (
  edge_id TEXT NOT NULL REFERENCES fleet_edges(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES mod_artifacts(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES mod_packages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'NOT_INSTALLED',
  installed_sha256 TEXT,
  bytes_on_disk BIGINT,
  error_code TEXT,
  error_message TEXT,
  progress_pct REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (edge_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_inventory_status ON edge_artifact_inventory(edge_id, status);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES fleet_edges(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES mod_artifacts(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('install', 'upgrade', 'remove', 'verify')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempt INT NOT NULL DEFAULT 0,
  locked_by TEXT,
  progress_pct REAL NOT NULL DEFAULT 0,
  phase TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_edge_state ON sync_jobs(edge_id, state);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_artifact ON sync_jobs(artifact_id, state);

CREATE TABLE IF NOT EXISTS sync_job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_job_events_job ON sync_job_events(job_id, created_at);

CREATE TABLE IF NOT EXISTS server_mod_requirements (
  server_name TEXT NOT NULL,
  edge_id TEXT NOT NULL REFERENCES fleet_edges(id) ON DELETE CASCADE,
  package_id UUID REFERENCES mod_packages(id) ON DELETE SET NULL,
  artifact_id UUID REFERENCES mod_artifacts(id) ON DELETE SET NULL,
  ac_content_slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_name, edge_id, ac_content_slug)
);

CREATE INDEX IF NOT EXISTS idx_server_mod_req_edge ON server_mod_requirements(edge_id, server_name);

CREATE TABLE IF NOT EXISTS mod_upload_sessions (
  upload_id UUID PRIMARY KEY,
  original_name TEXT NOT NULL,
  staging_path TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading',
  package_slug TEXT,
  display_name TEXT,
  kind TEXT,
  version_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
