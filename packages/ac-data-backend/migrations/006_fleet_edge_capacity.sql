-- Host capacity snapshot from mod-agent heartbeat (CPU/RAM/disk + AC server counts).

ALTER TABLE fleet_edges
  ADD COLUMN IF NOT EXISTS cpu_count INT,
  ADD COLUMN IF NOT EXISTS load1 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS mem_total_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mem_free_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS disk_total_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS servers_total INT,
  ADD COLUMN IF NOT EXISTS servers_running INT;
