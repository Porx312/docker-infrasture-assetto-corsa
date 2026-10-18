-- Folder-first artifacts: CONTENT_PATH is SoT; no permanent ZIP blob on edge.
-- storage_key convention: edge-folder:{edgeId}:{kind}:{slug}:{contentHash}

-- Include s3_canonical so re-applying this migration after library uploads
-- does not fail (rows already use storage_origin=s3_canonical).
ALTER TABLE mod_artifacts DROP CONSTRAINT IF EXISTS mod_artifacts_storage_origin_check;

ALTER TABLE mod_artifacts
  ADD CONSTRAINT mod_artifacts_storage_origin_check
  CHECK (storage_origin IN ('hub', 'edge', 'edge_folder', 's3_canonical'));
