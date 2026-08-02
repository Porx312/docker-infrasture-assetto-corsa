import { refreshHudAfterPlayerJoin } from '../hud/hudAfterPlayerJoin.js';
import { noteHudPlayerJoin } from '../hud/hudPlayerPresence.js';
import type { EventPayload } from './types.js';

export async function handlePlayerJoinAfterIngest(payload: EventPayload): Promise<void> {
  await noteHudPlayerJoin(payload);
  const joinData = (payload.data ?? {}) as Record<string, unknown>;
  const joinSteamId = typeof joinData.steamId === 'string' ? joinData.steamId.trim() : '';
  if (joinSteamId) {
    await refreshHudAfterPlayerJoin(joinSteamId);
  }
}
