import { connPresenceRedisKey, ssePresenceRedisKey } from './hudCacheKeys.js';
import {
  HUD_CONN_PRESENCE_TTL_SEC,
  hudRedisDel,
  hudRedisSet,
  hudRedisTouch,
  isHudRedisConfigured,
} from './hudRedis.js';

/**
 * Mark overlay connected (WSS). Dual-writes legacy `ac:hud:sse:*` for one release
 * so telemetry-data battle gates keep working.
 */
export async function markHudConnConnected(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  await hudRedisSet(connPresenceRedisKey(trimmed), '1', HUD_CONN_PRESENCE_TTL_SEC);
  await hudRedisSet(ssePresenceRedisKey(trimmed), '1', HUD_CONN_PRESENCE_TTL_SEC);
}

/** @deprecated Use markHudConnConnected */
export const markHudSseConnected = markHudConnConnected;

/** Extend connection presence TTL on keepalive. */
export async function renewHudConnPresence(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  await hudRedisTouch(connPresenceRedisKey(trimmed), HUD_CONN_PRESENCE_TTL_SEC);
  await hudRedisTouch(ssePresenceRedisKey(trimmed), HUD_CONN_PRESENCE_TTL_SEC);
}

/** @deprecated Use renewHudConnPresence */
export const renewHudSsePresence = renewHudConnPresence;

/** Clear connection presence when overlay disconnects. */
export async function clearHudConnPresence(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  await hudRedisDel(connPresenceRedisKey(trimmed));
  await hudRedisDel(ssePresenceRedisKey(trimmed));
}

/** @deprecated Use clearHudConnPresence */
export const clearHudSsePresence = clearHudConnPresence;
