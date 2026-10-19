-- User library links: steamId ↔ package (shared content-addressed blobs).
CREATE TABLE IF NOT EXISTS mod_steam_links (
  steam_id TEXT NOT NULL,
  package_id UUID NOT NULL REFERENCES mod_packages(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (steam_id, package_id)
);

CREATE INDEX IF NOT EXISTS idx_mod_steam_links_package ON mod_steam_links(package_id);
