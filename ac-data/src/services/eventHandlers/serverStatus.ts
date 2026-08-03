import { noteHudServerStatus } from '../hud/hudPlayerPresence.js';
import { noteLauncherServerPlayerCount } from '../launcherServerRegistry.js';
import { noteServerStatus } from '../serverPool.js';
import type { EventPayload } from './types.js';

/** Runs before Convex ingest (coalesced server_status). */
export async function handleServerStatusBeforeIngest(payload: EventPayload): Promise<void> {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const players = Array.isArray(data.players) ? data.players : [];
  const statusName = typeof payload.serverName === 'string' ? payload.serverName : '';
  noteServerStatus(statusName, players.length);
  noteLauncherServerPlayerCount(statusName, players.length);
  await noteHudServerStatus(payload);
}
