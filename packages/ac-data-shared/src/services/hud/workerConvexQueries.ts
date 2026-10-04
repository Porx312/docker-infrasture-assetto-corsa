import '../../config/loadEnv.js';
import { ensureConvexClient, isConvexConfigured } from '../convexClient.js';
import type { HudWorkerPresenceArgs } from './hudWorkerPresence.js';

export type { HudWorkerPresenceArgs } from './hudWorkerPresence.js';
export {
  hudWorkerPresenceFromRecord,
  readHudWorkerPresenceFromBody,
} from './hudWorkerPresence.js';

const CONVEX_WORKER_SECRET = (process.env.CONVEX_WORKER_SECRET || '').trim();
const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
const CONVEX_PLAYER_JOIN_QUERY =
  process.env.CONVEX_PLAYER_JOIN_QUERY || 'workerPlayers:getPlayerJoinContext';
const CONVEX_HUD_SESSION_QUERY =
  process.env.CONVEX_HUD_SESSION_QUERY || 'hud:getHudSession';
const CONVEX_HUD_VERSION_QUERY =
  process.env.CONVEX_HUD_VERSION_QUERY || 'hud:getHudVersion';
const CONVEX_CONFIG_SNAPSHOT_QUERY =
  process.env.CONVEX_CONFIG_SNAPSHOT_QUERY || 'timeAttackServers:getWorkerInstanceServerConfigs';

export type WorkerSyncVersionResult = {
  configVersion: string;
  pollIntervalMs: number;
  pollJitterMs: number;
};

export type WorkerConfigSnapshotResult = {
  instanceId: string;
  includeInactive: boolean;
  totalServers: number;
  maxUpdatedAt: number;
  version: string;
  servers: unknown[];
};

const DEFAULT_WORKER_SYNC: WorkerSyncVersionResult = {
  configVersion: '',
  pollIntervalMs: 30_000,
  pollJitterMs: 0,
};

function workerArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { workerSecret: CONVEX_WORKER_SECRET, ...extra };
}

export function isWorkerConvexQueryConfigured(): boolean {
  return isConvexConfigured() && Boolean(CONVEX_WORKER_SECRET);
}

export async function queryWorkerSyncVersion(
  instanceId: string,
): Promise<WorkerSyncVersionResult> {
  if (!isWorkerConvexQueryConfigured()) {
    throw new Error('Convex worker env missing');
  }
  const { query } = ensureConvexClient();
  const raw = await query(
    CONVEX_WORKER_SYNC_QUERY,
    workerArgs({ instanceId: instanceId.trim() || 'default' }),
  );
  const sync = raw as WorkerSyncVersionResult;
  return {
    configVersion: sync.configVersion ?? '',
    pollIntervalMs: sync.pollIntervalMs ?? 30_000,
    pollJitterMs: sync.pollJitterMs ?? 0,
  };
}

export async function queryPlayerJoinContext(
  steamId: string,
  presence?: HudWorkerPresenceArgs,
): Promise<unknown> {
  if (!isWorkerConvexQueryConfigured()) {
    throw new Error('Convex worker env missing');
  }
  const { query } = ensureConvexClient();
  return query(
    CONVEX_PLAYER_JOIN_QUERY,
    workerArgs({
      steamId: steamId.trim(),
      ...(presence ? { presence } : {}),
    }),
  );
}

export async function queryHudSession(
  steamId: string,
  presence?: HudWorkerPresenceArgs,
): Promise<unknown> {
  if (!isWorkerConvexQueryConfigured()) {
    throw new Error('Convex worker env missing');
  }
  const { query } = ensureConvexClient();
  return query(
    CONVEX_HUD_SESSION_QUERY,
    workerArgs({
      steamId: steamId.trim(),
      ...(presence ? { presence } : {}),
    }),
  );
}

export async function queryHudVersion(
  steamId: string,
  now?: number,
  presence?: HudWorkerPresenceArgs,
): Promise<unknown> {
  if (!isWorkerConvexQueryConfigured()) {
    throw new Error('Convex worker env missing');
  }
  const { query } = ensureConvexClient();
  const args: Record<string, unknown> = { steamId: steamId.trim() };
  if (now !== undefined) {
    args.now = now;
  }
  if (presence) {
    args.presence = presence;
  }
  return query(CONVEX_HUD_VERSION_QUERY, workerArgs(args));
}

export async function queryWorkerConfigSnapshot(
  instanceId: string,
): Promise<WorkerConfigSnapshotResult> {
  if (!isWorkerConvexQueryConfigured()) {
    throw new Error('Convex worker env missing');
  }
  const { query } = ensureConvexClient();
  const snapshotResult = await query(CONVEX_CONFIG_SNAPSHOT_QUERY, {
    workerSecret: CONVEX_WORKER_SECRET,
    instanceId: instanceId.trim(),
    includeInactive: true,
  });
  return snapshotResult as WorkerConfigSnapshotResult;
}

export { DEFAULT_WORKER_SYNC };
