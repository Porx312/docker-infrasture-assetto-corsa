import { ssePresenceRedisKey } from './hudCacheKeys.js';
import {
  HUD_SSE_PRESENCE_TTL_SEC,
  hudRedisDel,
  hudRedisSet,
  hudRedisTouch,
  isHudRedisConfigured,
} from './hudRedis.js';

/** Mark overlay SSE connected (battle matchmaking gate in telemetry-data). */
export async function markHudSseConnected(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  await hudRedisSet(ssePresenceRedisKey(trimmed), '1', HUD_SSE_PRESENCE_TTL_SEC);
}

/** Extend SSE presence TTL on keepalive. */
export async function renewHudSsePresence(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  await hudRedisTouch(ssePresenceRedisKey(trimmed), HUD_SSE_PRESENCE_TTL_SEC);
}

/** Clear SSE presence when overlay disconnects. */
export async function clearHudSsePresence(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  await hudRedisDel(ssePresenceRedisKey(trimmed));
}
