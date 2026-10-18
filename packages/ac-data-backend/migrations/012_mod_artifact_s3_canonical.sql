-- Allow library artifacts that exist only in Contabo S3 (no VPS CONTENT_PATH until needed).
ALTER TABLE mod_artifacts DROP CONSTRAINT IF EXISTS mod_artifacts_storage_origin_check;
ALTER TABLE mod_artifacts
  ADD CONSTRAINT mod_artifacts_storage_origin_check
  CHECK (storage_origin IN ('hub', 'edge', 'edge_folder', 's3_canonical'));
