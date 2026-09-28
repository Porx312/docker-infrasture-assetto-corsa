-- One preview/cover image per central library package (filename on hub disk).

ALTER TABLE mod_packages
  ADD COLUMN IF NOT EXISTS preview_image_filename TEXT;
