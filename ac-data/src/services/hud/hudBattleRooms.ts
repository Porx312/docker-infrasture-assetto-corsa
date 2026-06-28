import { buildBattleCacheKey } from './hudCacheKeys.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';
import type { BattleCacheParams } from './hudTypes.js';

/** Socket.io room / Redis scopeKey prefix for battle HUD. */
export const BATTLE_SCOPE_PREFIX = 'battle:';

/**
 * Room name matches telemetry `scopeKey`: `battle:{normalizedServerKey}:{steamId}`.
 */
export function battleRoomFromParams(serverName: string, steamId: string): string {
  const cacheKey = buildBattleCacheKey({
    serverName: normalizeHudServerName(serverName),
    steamId: steamId.trim(),
  });
  return `${BATTLE_SCOPE_PREFIX}${cacheKey}`;
}

export function battleRoomFromCacheKey(cacheKey: string): string {
  return `${BATTLE_SCOPE_PREFIX}${cacheKey}`;
}

export function isBattleScopeKey(scopeKey: string): boolean {
  return scopeKey.startsWith(BATTLE_SCOPE_PREFIX);
}

/**
 * Parse Redis pub/sub scopeKey into cache lookup params.
 * `serverName` is the normalized key part (same as buildBattleCacheKey input after normalize).
 */
export function parseBattleScopeKey(scopeKey: string): BattleCacheParams | null {
  if (!isBattleScopeKey(scopeKey)) {
    return null;
  }
  const cacheKey = scopeKey.slice(BATTLE_SCOPE_PREFIX.length);
  const colon = cacheKey.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  return {
    serverName: cacheKey.slice(0, colon),
    steamId: cacheKey.slice(colon + 1),
  };
}
