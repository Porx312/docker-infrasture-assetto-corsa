-- Edge-owned artifacts (no hub master ZIP). storage_key convention: edge:{edgeId}:{sha256}

ALTER TABLE mod_artifacts
  ADD COLUMN IF NOT EXISTS storage_origin TEXT NOT NULL DEFAULT 'hub'
    CHECK (storage_origin IN ('hub', 'edge'));

ALTER TABLE mod_artifacts
  ADD COLUMN IF NOT EXISTS source_edge_id TEXT;

CREATE INDEX IF NOT EXISTS idx_mod_artifacts_source_edge
  ON mod_artifacts(source_edge_id)
  WHERE source_edge_id IS NOT NULL;
