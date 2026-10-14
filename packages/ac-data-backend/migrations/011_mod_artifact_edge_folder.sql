-- Folder-first artifacts: CONTENT_PATH is SoT; no permanent ZIP blob on edge.
-- storage_key convention: edge-folder:{edgeId}:{kind}:{slug}:{contentHash}

ALTER TABLE mod_artifacts DROP CONSTRAINT IF EXISTS mod_artifacts_storage_origin_check;

ALTER TABLE mod_artifacts
  ADD CONSTRAINT mod_artifacts_storage_origin_check
  CHECK (storage_origin IN ('hub', 'edge', 'edge_folder'));
