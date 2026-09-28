-- Server slots (platform SoT for allocate / start / stop / applied config)
-- Requires DATABASE_URL (same pool as mod repository).

CREATE TABLE IF NOT EXISTS server_slots (
  id UUID PRIMARY KEY,
  instance_id TEXT NOT NULL,
  region TEXT NOT NULL,
  lobby_name TEXT NOT NULL,
  folder_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'allocated', 'live', 'draining', 'error')),
  applied_config JSONB,
  preset_ref TEXT,
  player_count INT NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (instance_id, folder_slug)
);

CREATE INDEX IF NOT EXISTS idx_server_slots_region_status
  ON server_slots (region, status);

CREATE INDEX IF NOT EXISTS idx_server_slots_instance
  ON server_slots (instance_id);

CREATE INDEX IF NOT EXISTS idx_server_slots_lobby
  ON server_slots (lobby_name);
