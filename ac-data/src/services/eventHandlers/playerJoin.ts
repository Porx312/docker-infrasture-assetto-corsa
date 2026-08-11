import { refreshHudAfterPlayerJoin } from '../hud/hudAfterPlayerJoin.js';
import { noteHudPlayerJoin } from '../hud/hudPlayerPresence.js';
import type { EventPayload } from './types.js';

function playerJoinSteamId(payload: EventPayload): string {
  const joinData = (payload.data ?? {}) as Record<string, unknown>;
  return typeof joinData.steamId === 'string' ? joinData.steamId.trim() : '';
}

/** Immediate HUD presence + Convex join refresh — do not wait for ingest batch. */
export async function handlePlayerJoinBeforeIngest(payload: EventPayload): Promise<void> {
  await noteHudPlayerJoin(payload);
  const joinSteamId = playerJoinSteamId(payload);
  if (joinSteamId) {
    await refreshHudAfterPlayerJoin(joinSteamId);
  }
}

export async function handlePlayerJoinAfterIngest(payload: EventPayload): Promise<void> {
  await handlePlayerJoinBeforeIngest(payload);
}
