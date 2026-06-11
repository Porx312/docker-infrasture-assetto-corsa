import type { LbCacheParams, PlayerCacheParams, SessionQueryParams } from './hudTypes.js';

/** Matches Convex hud.getHudSnapshotsForWorker normalizeKey. */
export function normalizeHudKeyPart(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Matches Convex: `${normalizeKey(serverName)}@${track.track}@${layoutConfig}@${carFilter}`
 */
export function buildLbCacheKey(params: LbCacheParams): string {
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

export const HUD_LB_PREFIX = 'ac:hud:lb:';
export const HUD_PLAYER_PREFIX = 'ac:hud:player:';
export const HUD_SESSION_PREFIX = 'ac:hud:session:';

export function lbRedisKey(cacheKey: string): string {
  return `${HUD_LB_PREFIX}${cacheKey}`;
}

export function playerRedisKey(cacheKey: string): string {
  return `${HUD_PLAYER_PREFIX}${cacheKey}`;
}

export function sessionRedisKey(cacheKey: string): string {
  return `${HUD_SESSION_PREFIX}${cacheKey}`;
}
