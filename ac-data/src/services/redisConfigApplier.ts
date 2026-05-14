import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from 'redis';
import {
  activeServers,
  applyServerConfiguration,
  cleanupOrphanProcesses,
  restartServerCore,
  startServerCore,
  stopServerCore,
  ServerConfigPayload,
} from '../controller/controller.js';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || '';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB || 0);
const REDIS_SSL = (process.env.REDIS_SSL || 'false').trim().toLowerCase() === 'true';
const REDIS_CONFIG_STREAM_KEY = process.env.REDIS_CONFIG_STREAM_KEY || 'ac:config';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

// Each VPS uses its own consumer group so every node receives every snapshot.
// A shared group would have Redis route each message to a single consumer,
// causing other VPS to miss config updates for their own instanceId.
const APPLIER_GROUP =
  process.env.REDIS_CONFIG_APPLIER_GROUP || `ac-data-config-appliers-${AC_INSTANCE_ID}`;
const APPLIER_CONSUMER =
  process.env.REDIS_CONFIG_APPLIER_NAME || `applier-${AC_INSTANCE_ID}`;
const APPLIER_ENABLED =
  (process.env.REDIS_CONFIG_APPLIER_ENABLED || 'true').trim().toLowerCase() === 'true';
const RESTART_ON_BOOT =
  (process.env.REDIS_CONFIG_APPLIER_RESTART_ON_BOOT || 'false').trim().toLowerCase() === 'true';

type ServerRow = {
  serverId?: string;
  serverName: string;
  displayName?: string;
  type?: string;
  isActive?: boolean;
  instanceId?: string;
  password?: string;
  maxClients?: number;
  rotationEnabled?: boolean;
  track?: string;
  trackName?: string;
  trackConfig?: string;
  entries?: Array<{ model: string; skin?: string; count?: number }>;
  updatedAt?: number;
};

type StreamMessage = {
  id: string;
  fields?: Record<string, string>;
  message?: Record<string, string>;
};

type StreamReadResult = Array<{
  name: string;
  messages: StreamMessage[];
}>;

const lastSignatures = new Map<string, string>();

function parsePayload(message: StreamMessage): Record<string, unknown> | null {
  const raw = message.fields?.payload ?? message.message?.payload;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildSignature(row: ServerRow): string {
  const normalized = {
    displayName: row.displayName ?? '',
    password: row.password ?? '',
    track: row.track ?? '',
    trackConfig: row.trackConfig ?? '',
    maxClients: row.maxClients ?? 0,
    isActive: !!row.isActive,
    entries: (row.entries ?? []).map((e) => ({
      model: e.model,
      skin: e.skin ?? '',
      count: e.count ?? 1,
    })),
  };
  return crypto.createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
}

function rowToConfigPayload(row: ServerRow): ServerConfigPayload {
  const payload: ServerConfigPayload = {};
  if (row.displayName !== undefined) payload.displayName = row.displayName;
  if (row.password !== undefined) payload.password = row.password;
  if (row.track !== undefined) payload.track = row.track;
  if (row.trackConfig !== undefined) payload.configTrack = row.trackConfig;
  if (row.maxClients !== undefined) payload.maxClients = row.maxClients;
  if (row.entries !== undefined) payload.entries = row.entries;
  return payload;
}

function getAvailableCars(): Set<string> {
  const serversPath = process.env.SERVERS_PATH;
  if (!serversPath) return new Set();
  const contentBase = path.join(serversPath, 'content');
  const carsPath = path.join(contentBase, 'cars');
  const available = new Set<string>();
  try {
    const entries = fs.readdirSync(carsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const carPath = path.join(carsPath, entry.name);
        const hasKn5 = fs.existsSync(path.join(carPath, `${entry.name}.kn5`)) ||
                       fs.readdirSync(carPath).some(f => f.endsWith('.kn5'));
        const hasCollider = fs.existsSync(path.join(carPath, 'collider.kn5'));
        const hasDataAcd = fs.existsSync(path.join(carPath, 'data.acd'));
        if (hasKn5 && hasCollider && hasDataAcd) {
          available.add(entry.name);
        }
      }
    }
  } catch (err) {
    console.error('[redis-config-applier] error scanning cars:', err);
  }
  return available;
}

function filterValidEntries(
  entries: Array<{ model: string; skin?: string; count?: number }>,
  availableCars: Set<string>,
): Array<{ model: string; skin?: string; count?: number }> | null {
  if (!entries || entries.length === 0) return null;
  const validEntries = entries.filter(e => availableCars.has(e.model));
  if (validEntries.length === 0) return null;
  if (validEntries.length !== entries.length) {
    const missing = entries.map(e => e.model).filter(m => !availableCars.has(m));
    console.warn(`[redis-config-applier] skipping cars not available locally: ${missing.join(', ')}`);
  }
  return validEntries;
}

async function reconcileServer(row: ServerRow, isFirstSnapshot: boolean): Promise<void> {
  if (!row || !row.serverName) return;
  if (row.instanceId && row.instanceId !== AC_INSTANCE_ID) return;

  const availableCars = getAvailableCars();
  const entries = row.entries ? filterValidEntries(row.entries, availableCars) : undefined;
  if (entries === null && row.entries && row.entries.length > 0) {
    console.warn(`[redis-config-applier] ${row.serverName} skipped: no valid cars locally`);
    return;
  }
  if (entries) {
    row = { ...row, entries };
  }

  const signature = buildSignature(row);
  const previous = lastSignatures.get(row.serverName);
  const changed = previous !== signature;
  const running = !!activeServers[row.serverName]?.pid;

  if (!changed && !isFirstSnapshot) {
    return;
  }

  if (row.isActive === false) {
    if (running) {
      const result = await stopServerCore(row.serverName);
      console.log(
        `[redis-config-applier] stop ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}`,
      );
    } else {
      console.log(`[redis-config-applier] ${row.serverName} inactive (no process to stop)`);
    }
    lastSignatures.set(row.serverName, signature);
    return;
  }

  const apply = applyServerConfiguration(row.serverName, rowToConfigPayload(row));
  if (!apply.ok) {
    console.warn(`[redis-config-applier] applyConfig ${row.serverName} failed: ${apply.reason}`);
  } else if (apply.modifications.length) {
    console.log(
      `[redis-config-applier] applyConfig ${row.serverName} updated: ${apply.modifications.join(', ')}`,
    );
  }

  if (running && changed) {
    const result = await restartServerCore(row.serverName);
    console.log(
      `[redis-config-applier] restart ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}`,
    );
  } else if (!running) {
    if (isFirstSnapshot && !RESTART_ON_BOOT) {
      console.log(`[redis-config-applier] ${row.serverName} first snapshot skip (RESTART_ON_BOOT=false)`);
    } else {
      const result = startServerCore(row.serverName);
      console.log(
        `[redis-config-applier] start ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}`,
      );
    }
  } else {
    console.log(`[redis-config-applier] ${row.serverName} already running, config${changed ? ' changed' : ' unchanged'}`);
  }

  lastSignatures.set(row.serverName, signature);
}

async function handleSnapshot(payload: Record<string, unknown>, isFirstSnapshot: boolean): Promise<void> {
  const data = (payload.data as Record<string, unknown>) ?? {};
  const instanceId = String(data.instanceId ?? payload.instanceId ?? '');
  if (instanceId && instanceId !== AC_INSTANCE_ID) return;

  const rows = (data.servers as ServerRow[]) ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return;

  for (const row of rows) {
    try {
      await reconcileServer(row, isFirstSnapshot);
    } catch (err) {
      console.error(`[redis-config-applier] reconcile ${row?.serverName} error:`, err);
    }
  }
}

export async function startRedisConfigApplier(): Promise<void> {
  if (!APPLIER_ENABLED) {
    console.log('[redis-config-applier] disabled');
    return;
  }
  if (!REDIS_HOST) {
    console.log('[redis-config-applier] REDIS_HOST missing, applier disabled');
    return;
  }

  const socket = REDIS_SSL
    ? { host: REDIS_HOST, port: REDIS_PORT, tls: true as const }
    : { host: REDIS_HOST, port: REDIS_PORT };

  const client = createClient({
    socket,
    ...(REDIS_USERNAME ? { username: REDIS_USERNAME } : {}),
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    database: REDIS_DB,
  });
  client.on('error', (err) => console.error('[redis-config-applier] redis error:', err));
  await client.connect();

  try {
    await client.xGroupCreate(REDIS_CONFIG_STREAM_KEY, APPLIER_GROUP, '$', { MKSTREAM: true });
    console.log(`[redis-config-applier] consumer group created: ${APPLIER_GROUP}`);
  } catch {
    // group already exists
  }

  console.log(
    `[redis-config-applier] listening stream=${REDIS_CONFIG_STREAM_KEY} group=${APPLIER_GROUP} consumer=${APPLIER_CONSUMER} instance=${AC_INSTANCE_ID}`,
  );

  await cleanupOrphanProcesses();

  let isFirstSnapshot = true;
  while (true) {
    try {
      const raw = await client.xReadGroup(
        APPLIER_GROUP,
        APPLIER_CONSUMER,
        { key: REDIS_CONFIG_STREAM_KEY, id: '>' },
        { COUNT: 5, BLOCK: 5000 },
      );
      const results = (raw ?? null) as unknown as StreamReadResult | null;
      if (!results || results.length === 0) continue;

      for (const stream of results) {
        for (const msg of stream.messages) {
          const payload = parsePayload(msg);
          if (!payload || payload.event !== 'server_config_snapshot') {
            await client.xAck(REDIS_CONFIG_STREAM_KEY, APPLIER_GROUP, msg.id);
            continue;
          }
          try {
            await handleSnapshot(payload, isFirstSnapshot);
            isFirstSnapshot = false;
          } catch (err) {
            console.error('[redis-config-applier] snapshot handler error:', err);
          }
          await client.xAck(REDIS_CONFIG_STREAM_KEY, APPLIER_GROUP, msg.id);
        }
      }
    } catch (err) {
      console.error('[redis-config-applier] loop error:', err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
