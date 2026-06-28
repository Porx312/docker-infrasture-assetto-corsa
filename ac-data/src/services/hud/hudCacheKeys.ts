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
  const trackConfig = params.trackConfig ?? '';
  const carModel = params.carModel ?? '';
  return `${params.steamId}@${normalizeHudKeyPart(params.serverName)}@${params.track}@${trackConfig}@${carModel}`;
}

export function buildSessionCacheKey(params: SessionQueryParams): string {
  const trackConfig = params.trackConfig ?? '';
  const carFilter = params.carFilter ?? 'global';
  const carModel = params.carModel ?? '';
  return `${params.steamId}@${normalizeHudKeyPart(params.serverName)}@${params.track}@${trackConfig}@${carFilter}@${carModel}`;
}

export const HUD_PLAYER_PREFIX = 'ac:hud:player:';
export const HUD_SESSION_PREFIX = 'ac:hud:session:';
export const HUD_BATTLE_PREFIX = 'ac:hud:battle:';
export const HUD_PRESENCE_PREFIX = 'ac:hud:presence:';
export const HUD_PRESENCE_ROSTER_PREFIX = 'ac:hud:presence:roster:';

export function presenceRedisKey(steamId: string): string {
  return `${HUD_PRESENCE_PREFIX}${steamId}`;
}

export function presenceRosterRedisKey(normalizedServerName: string): string {
  return `${HUD_PRESENCE_ROSTER_PREFIX}${normalizedServerName}`;
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

export function battleVersionRedisKey(cacheKey: string): string {
  return `ac:hud:ver:battle:${cacheKey}`;
}
