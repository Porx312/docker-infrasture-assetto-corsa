import '../../config/loadEnv.js';
import { ensureConvexClient } from '../convexClient.js';
import type {
  HudSessionResult,
  HudVersionQueryParams,
  HudVersionResult,
  PlayerJoinContextResult,
  SessionQueryParams,
  WorkerSyncVersionResult,
} from './hudTypes.js';

const CONVEX_WORKER_SECRET = (process.env.CONVEX_WORKER_SECRET || '').trim();
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
const CONVEX_PLAYER_JOIN_QUERY =
  process.env.CONVEX_PLAYER_JOIN_QUERY || 'workerPlayers:getPlayerJoinContext';
const CONVEX_HUD_SESSION_QUERY =
  process.env.CONVEX_HUD_SESSION_QUERY || 'hud:getHudSession';
const CONVEX_HUD_VERSION_QUERY =
  process.env.CONVEX_HUD_VERSION_QUERY || 'hud:getHudVersion';

export function isHudConvexConfigured(): boolean {
  return Boolean(CONVEX_WORKER_SECRET);
}

function workerArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { workerSecret: CONVEX_WORKER_SECRET, ...extra };
}

export async function fetchWorkerSyncVersion(): Promise<WorkerSyncVersionResult> {
  const { query } = ensureConvexClient();
  const raw = await query(CONVEX_WORKER_SYNC_QUERY, workerArgs({ instanceId: AC_INSTANCE_ID }));
  const result = raw as WorkerSyncVersionResult;
  return {
    configVersion: result.configVersion ?? '',
    pollIntervalMs: result.pollIntervalMs ?? 30_000,
    pollJitterMs: result.pollJitterMs ?? 0,
  };
}

export async function fetchPlayerJoinContext(steamId: string): Promise<PlayerJoinContextResult> {
  const { query } = ensureConvexClient();
  const raw = await query(
    CONVEX_PLAYER_JOIN_QUERY,
    workerArgs({ steamId: steamId.trim() }),
  );
  return raw as PlayerJoinContextResult;
}

export async function fetchHudSession(params: SessionQueryParams): Promise<HudSessionResult> {
  const { query } = ensureConvexClient();
  const raw = await query(
    CONVEX_HUD_SESSION_QUERY,
    workerArgs({ steamId: params.steamId }),
  );
  return raw as HudSessionResult;
}

export async function fetchHudVersion(params: HudVersionQueryParams): Promise<HudVersionResult> {
  const { query } = ensureConvexClient();
  const args: Record<string, unknown> = { steamId: params.steamId };
  if (params.now !== undefined) {
    args.now = params.now;
  }
  const raw = await query(CONVEX_HUD_VERSION_QUERY, workerArgs(args));
  return raw as HudVersionResult;
}
