import { randomUUID } from 'node:crypto';
import { getModPool, isModDbConfigured } from '../mods/db.js';

export type ServerSlotStatus = 'idle' | 'allocated' | 'live' | 'draining' | 'error';

export type ServerSlotRow = {
  id: string;
  instanceId: string;
  region: string;
  lobbyName: string;
  folderSlug: string;
  status: ServerSlotStatus;
  appliedConfig: unknown | null;
  presetRef: string | null;
  playerCount: number;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  id: string;
  instance_id: string;
  region: string;
  lobby_name: string;
  folder_slug: string;
  status: string;
  applied_config: unknown;
  preset_ref: string | null;
  player_count: number;
  last_heartbeat_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const STATUS_SET = new Set<ServerSlotStatus>([
  'idle',
  'allocated',
  'live',
  'draining',
  'error',
]);

export function isServerSlotsDbConfigured(): boolean {
  return isModDbConfigured();
}

function mapRow(row: DbRow): ServerSlotRow {
  const status = STATUS_SET.has(row.status as ServerSlotStatus)
    ? (row.status as ServerSlotStatus)
    : 'error';
  return {
    id: row.id,
    instanceId: row.instance_id,
    region: row.region,
    lobbyName: row.lobby_name,
    folderSlug: row.folder_slug,
    status,
    appliedConfig: row.applied_config ?? null,
    presetRef: row.preset_ref,
    playerCount: Number(row.player_count) || 0,
    lastHeartbeatAt: row.last_heartbeat_at ? row.last_heartbeat_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export type UpsertServerSlotInput = {
  instanceId: string;
  region: string;
  lobbyName: string;
  folderSlug: string;
  status?: ServerSlotStatus;
};

export async function upsertServerSlot(input: UpsertServerSlotInput): Promise<ServerSlotRow> {
  const pool = getModPool();
  const id = randomUUID();
  const status = input.status ?? 'idle';
  const result = await pool.query<DbRow>(
    `INSERT INTO server_slots (
       id, instance_id, region, lobby_name, folder_slug, status, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (instance_id, folder_slug) DO UPDATE SET
       region = EXCLUDED.region,
       lobby_name = EXCLUDED.lobby_name,
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      input.instanceId.trim(),
      input.region.trim(),
      input.lobbyName.trim(),
      input.folderSlug.trim(),
      status,
    ],
  );
  return mapRow(result.rows[0]!);
}

export async function getServerSlotById(slotId: string): Promise<ServerSlotRow | null> {
  const pool = getModPool();
  const result = await pool.query<DbRow>(`SELECT * FROM server_slots WHERE id = $1`, [
    slotId.trim(),
  ]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export type ListServerSlotsFilter = {
  region?: string;
  status?: ServerSlotStatus;
  instanceId?: string;
};

export async function listServerSlots(
  filter: ListServerSlotsFilter = {},
): Promise<ServerSlotRow[]> {
  const pool = getModPool();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.region?.trim()) {
    params.push(filter.region.trim());
    clauses.push(`region = $${params.length}`);
  }
  if (filter.status && STATUS_SET.has(filter.status)) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filter.instanceId?.trim()) {
    params.push(filter.instanceId.trim());
    clauses.push(`instance_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query<DbRow>(
    `SELECT * FROM server_slots ${where} ORDER BY region ASC, lobby_name ASC`,
    params,
  );
  return result.rows.map(mapRow);
}

export type AllocateServerSlotInput = {
  region: string;
  presetRef?: string;
};

export async function allocateServerSlot(
  input: AllocateServerSlotInput,
): Promise<ServerSlotRow | null> {
  const pool = getModPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<DbRow>(
      `SELECT * FROM server_slots
       WHERE region = $1 AND status = 'idle'
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [input.region.trim()],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    const updated = await client.query<DbRow>(
      `UPDATE server_slots
       SET status = 'allocated',
           preset_ref = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [row.id, input.presetRef?.trim() || null],
    );
    await client.query('COMMIT');
    return mapRow(updated.rows[0]!);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function patchServerSlot(
  slotId: string,
  patch: {
    status?: ServerSlotStatus;
    appliedConfig?: unknown;
    presetRef?: string | null;
    playerCount?: number;
    lastHeartbeatAt?: Date | null;
    lobbyName?: string;
  },
): Promise<ServerSlotRow | null> {
  const pool = getModPool();
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  if (patch.status && STATUS_SET.has(patch.status)) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  if (patch.appliedConfig !== undefined) {
    params.push(JSON.stringify(patch.appliedConfig));
    sets.push(`applied_config = $${params.length}::jsonb`);
  }
  if (patch.presetRef !== undefined) {
    params.push(patch.presetRef);
    sets.push(`preset_ref = $${params.length}`);
  }
  if (typeof patch.playerCount === 'number') {
    params.push(patch.playerCount);
    sets.push(`player_count = $${params.length}`);
  }
  if (patch.lastHeartbeatAt !== undefined) {
    params.push(patch.lastHeartbeatAt);
    sets.push(`last_heartbeat_at = $${params.length}`);
  }
  if (patch.lobbyName?.trim()) {
    params.push(patch.lobbyName.trim());
    sets.push(`lobby_name = $${params.length}`);
  }
  params.push(slotId.trim());
  const result = await pool.query<DbRow>(
    `UPDATE server_slots SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** Soft-sync from agent presence servers[] (no allocate changes). */
export async function syncSlotsFromAgentPresence(input: {
  instanceId: string;
  region?: string;
  servers: Array<{
    serverId?: string;
    name?: string;
    status?: string;
    playerCount?: number;
  }>;
}): Promise<number> {
  if (!isServerSlotsDbConfigured()) {
    return 0;
  }
  const instanceId = input.instanceId.trim();
  if (!instanceId || input.servers.length === 0) {
    return 0;
  }
  const pool = getModPool();
  let touched = 0;
  const now = new Date();
  for (const server of input.servers) {
    const folderSlug = (server.serverId || server.name || '').trim();
    const lobbyName = (server.name || server.serverId || '').trim();
    if (!folderSlug || !lobbyName) {
      continue;
    }
    const playerCount =
      typeof server.playerCount === 'number' && Number.isFinite(server.playerCount)
        ? Math.max(0, Math.floor(server.playerCount))
        : 0;
    const agentStatus = (server.status || '').toLowerCase();
    let status: ServerSlotStatus | undefined;
    if (agentStatus === 'live' || playerCount > 0) {
      status = 'live';
    } else if (agentStatus === 'idle' || agentStatus === 'draining' || agentStatus === 'error') {
      status = agentStatus as ServerSlotStatus;
    }

    const existing = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM server_slots WHERE instance_id = $1 AND folder_slug = $2`,
      [instanceId, folderSlug],
    );
    if (existing.rows[0]) {
      const keepAllocated =
        existing.rows[0].status === 'allocated' && status !== 'live' && playerCount === 0;
      await patchServerSlot(existing.rows[0].id, {
        lobbyName,
        playerCount,
        lastHeartbeatAt: now,
        status: keepAllocated ? 'allocated' : status,
      });
      touched += 1;
      continue;
    }

    const region = (input.region || 'default').trim() || 'default';
    const created = await upsertServerSlot({
      instanceId,
      region,
      lobbyName,
      folderSlug,
      status: status ?? 'idle',
    });
    await patchServerSlot(created.id, { playerCount, lastHeartbeatAt: now });
    touched += 1;
  }
  return touched;
}
