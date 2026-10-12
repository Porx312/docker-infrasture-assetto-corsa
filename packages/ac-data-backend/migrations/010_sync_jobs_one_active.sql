-- At most one active (queued|running) sync job per edge + artifact (AUD2-07).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_one_active_per_edge_artifact
  ON sync_jobs (edge_id, artifact_id)
  WHERE state IN ('queued', 'running');
