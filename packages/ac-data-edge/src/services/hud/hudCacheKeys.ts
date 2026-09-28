import type { BoardCacheParams, PlayerCacheParams, SessionQueryParams, BattleCacheParams } from './hudTypes.js';

/** Matches Convex board scope key: `${normalizeKey(serverName)}@${track}@${layout}@${carFilter}` */
export function normalizeHudKeyPart(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

export function buildBoardCacheKey(params: BoardCacheParams): string {
  const layoutConfig = params.trackConfig ?? '';
  const car = params.car ?? 'global';
  const baseKey = `${normalizeHudKeyPart(params.serverName)}@${params.track}@${layoutConfig}`;
  return `${baseKey}@${car}`;
}

export function buildPlayerCacheKey(params: PlayerCacheParams): string {
  return params.steamId;
}

export function buildSessionCacheKey(params: SessionQueryParams): string {
  return params.steamId;
}

export const HUD_PLAYER_PREFIX = 'ac:hud:player:';
export const HUD_SESSION_PREFIX = 'ac:hud:session:';
export const HUD_BATTLE_PREFIX = 'ac:hud:battle:';
export const HUD_BATTLE_PROFILE_PREFIX = 'ac:hud:battle:profile:';
export const HUD_PRESENCE_PREFIX = 'ac:hud:presence:';
export const HUD_PRESENCE_ROSTER_PREFIX = 'ac:hud:presence:roster:';
export const HUD_SSE_PRESENCE_PREFIX = 'ac:hud:sse:';

export function ssePresenceRedisKey(steamId: string): string {
  return `${HUD_SSE_PRESENCE_PREFIX}${steamId}`;
}

export function presenceRedisKey(steamId: string): string {
  return `${HUD_PRESENCE_PREFIX}${steamId}`;
}

/**
 * Roster Redis key scoped by VPS instanceId to avoid lobby-name collisions across the fleet.
 * Format: `ac:hud:presence:roster:{instanceId}:{normalizedServerName}`
 * Legacy (no instanceId): `ac:hud:presence:roster:{normalizedServerName}`
 */
export function presenceRosterRedisKey(
  normalizedServerName: string,
  instanceId?: string | null,
): string {
  const server = normalizedServerName.trim();
  const instance = (instanceId || '').trim();
  if (instance) {
    return `${HUD_PRESENCE_ROSTER_PREFIX}${instance}:${server}`;
  }
  return `${HUD_PRESENCE_ROSTER_PREFIX}${server}`;
}

/** Parse roster Redis key suffix after `ac:hud:presence:roster:`. */
export function parsePresenceRosterKeySuffix(suffix: string): {
  instanceId: string | null;
  serverId: string;
} {
  const trimmed = suffix.trim();
  const sep = trimmed.indexOf(':');
  if (sep <= 0) {
    return { instanceId: null, serverId: trimmed };
  }
  return {
    instanceId: trimmed.slice(0, sep),
    serverId: trimmed.slice(sep + 1),
  };
}

export function playerRedisKey(cacheKey: string): string {
  return `${HUD_PLAYER_PREFIX}${cacheKey}`;
}

export function sessionRedisKey(cacheKey: string): string {
  return `${HUD_SESSION_PREFIX}${cacheKey}`;
}

export function buildBattleCacheKey(params: BattleCacheParams): string {
  return `${normalizeHudKeyPart(params.serverName)}:${params.steamId}`;
}

export function battleRedisKey(cacheKey: string): string {
  return `${HUD_BATTLE_PREFIX}${cacheKey}`;
}

export function battleProfileRedisKey(steamId: string): string {
  return `${HUD_BATTLE_PROFILE_PREFIX}${steamId.trim()}`;
}

export function battleVersionRedisKey(cacheKey: string): string {
  return `ac:hud:ver:battle:${cacheKey}`;
}
