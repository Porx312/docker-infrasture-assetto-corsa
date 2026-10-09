import { connPresenceRedisKey } from '@projectd/ac-data-shared/services/hud/hudCacheKeys.js';
import {
  HUD_CONN_PRESENCE_TTL_SEC,
  hudRedisDel,
  hudRedisSet,
  hudRedisTouch,
  isHudRedisConfigured,
} from '@projectd/ac-data-shared/services/hud/hudRedis.js';

/**
 * Mark overlay connected (WSS). Writes `ac:hud:conn:{steamId}` for telemetry gates.
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
}

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
}

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
}
