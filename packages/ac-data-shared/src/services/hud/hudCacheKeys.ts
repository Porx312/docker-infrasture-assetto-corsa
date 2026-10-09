/** Shared Redis key builders for HUD caches (hub + edge must stay identical). */

export type HudBoardCacheParams = {
  serverName: string;
  track: string;
  trackConfig?: string;
  car?: string;
};

export type HudPlayerCacheParams = {
  steamId: string;
};

export type HudSessionCacheParams = HudPlayerCacheParams;

export type HudBattleCacheParams = {
  serverName: string;
  steamId: string;
};

/** Matches Convex board scope key: `${normalizeKey(serverName)}@${track}@${layout}@${carFilter}` */
export function normalizeHudKeyPart(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

export function buildBoardCacheKey(params: HudBoardCacheParams): string {
  const layoutConfig = params.trackConfig ?? '';
  const car = params.car ?? 'global';
  const baseKey = `${normalizeHudKeyPart(params.serverName)}@${params.track}@${layoutConfig}`;
  return `${baseKey}@${car}`;
}

export function buildPlayerCacheKey(params: HudPlayerCacheParams): string {
  return params.steamId;
}

export function buildSessionCacheKey(params: HudSessionCacheParams): string {
  return params.steamId;
}

export const HUD_PLAYER_PREFIX = 'ac:hud:player:';
export const HUD_SESSION_PREFIX = 'ac:hud:session:';
export const HUD_BATTLE_PREFIX = 'ac:hud:battle:';
export const HUD_BATTLE_PROFILE_PREFIX = 'ac:hud:battle:profile:';
export const HUD_PRESENCE_PREFIX = 'ac:hud:presence:';
export const HUD_PRESENCE_ROSTER_PREFIX = 'ac:hud:presence:roster:';
/** Overlay connection gate (WSS). Primary key. */
export const HUD_CONN_PRESENCE_PREFIX = 'ac:hud:conn:';
/** @deprecated Legacy SSE key — dual-written one release for telemetry-data. */
export const HUD_SSE_PRESENCE_PREFIX = 'ac:hud:sse:';
export const HUD_VER_PREFIX = 'ac:hud:ver:';

export function connPresenceRedisKey(steamId: string): string {
  return `${HUD_CONN_PRESENCE_PREFIX}${steamId}`;
}

/** @deprecated Use connPresenceRedisKey */
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

export function buildBattleCacheKey(params: HudBattleCacheParams): string {
  return `${normalizeHudKeyPart(params.serverName)}:${params.steamId}`;
}

export function battleRedisKey(cacheKey: string): string {
  return `${HUD_BATTLE_PREFIX}${cacheKey}`;
}

export function battleProfileRedisKey(steamId: string): string {
  return `${HUD_BATTLE_PROFILE_PREFIX}${steamId.trim()}`;
}

export function battleVersionRedisKey(cacheKey: string): string {
  return `${HUD_VER_PREFIX}battle:${cacheKey}`;
}
