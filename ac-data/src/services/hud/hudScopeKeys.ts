import { isBattleScopeKey } from './hudBattleRooms.js';

export const BOARD_SCOPE_PREFIX = 'board:';
export const PLAYER_SCOPE_PREFIX = 'player:';

export function boardScopeKeyFromCacheKey(cacheKey: string): string {
  return `${BOARD_SCOPE_PREFIX}${cacheKey}`;
}

export function playerScopeKeyFromCacheKey(cacheKey: string): string {
  return `${PLAYER_SCOPE_PREFIX}${cacheKey}`;
}

export function boardRoomFromCacheKey(cacheKey: string): string {
  return boardScopeKeyFromCacheKey(cacheKey);
}

export function playerRoomFromCacheKey(cacheKey: string): string {
  return playerScopeKeyFromCacheKey(cacheKey);
}

export function parseBoardScopeKey(scopeKey: string): { cacheKey: string } | null {
  if (!scopeKey.startsWith(BOARD_SCOPE_PREFIX)) {
    return null;
  }
  const cacheKey = scopeKey.slice(BOARD_SCOPE_PREFIX.length);
  return cacheKey ? { cacheKey } : null;
}

export function parsePlayerScopeKey(scopeKey: string): { cacheKey: string } | null {
  if (!scopeKey.startsWith(PLAYER_SCOPE_PREFIX)) {
    return null;
  }
  const cacheKey = scopeKey.slice(PLAYER_SCOPE_PREFIX.length);
  return cacheKey ? { cacheKey } : null;
}

export function isHudUpdateScopeKey(scopeKey: string): boolean {
  return (
    isBattleScopeKey(scopeKey) ||
    parseBoardScopeKey(scopeKey) !== null ||
    parsePlayerScopeKey(scopeKey) !== null
  );
}
