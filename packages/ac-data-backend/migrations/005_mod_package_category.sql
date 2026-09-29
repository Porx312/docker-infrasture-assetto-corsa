-- Optional catalog label for grouping (drift, pack, touge, …). Not car/track — that is `kind`.

ALTER TABLE mod_packages
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_mod_packages_category ON mod_packages (category)
  WHERE category IS NOT NULL;
