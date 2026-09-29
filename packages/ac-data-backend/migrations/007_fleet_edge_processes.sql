-- Per-process AC / CM-proxy samples from mod-agent heartbeat (RSS + CPU%).

ALTER TABLE fleet_edges
  ADD COLUMN IF NOT EXISTS processes_json JSONB;
