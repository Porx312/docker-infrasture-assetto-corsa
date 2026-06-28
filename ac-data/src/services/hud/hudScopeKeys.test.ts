import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boardScopeKeyFromCacheKey,
  isHudUpdateScopeKey,
  parseBoardScopeKey,
  parsePlayerScopeKey,
  playerScopeKeyFromCacheKey,
} from './hudScopeKeys.js';

test('board and player scope keys use explicit prefixes', () => {
  assert.equal(boardScopeKeyFromCacheKey('projectd@pk_akina@@global'), 'board:projectd@pk_akina@@global');
  assert.equal(
    playerScopeKeyFromCacheKey('76561199000000001@projectd@pk_akina@downhill@car'),
    'player:76561199000000001@projectd@pk_akina@downhill@car',
  );
});

test('parseBoardScopeKey and parsePlayerScopeKey round-trip cache keys', () => {
  const board = boardScopeKeyFromCacheKey('projectd@track@@global');
  const player = playerScopeKeyFromCacheKey('steam@projectd@track@@car');

  assert.deepEqual(parseBoardScopeKey(board), { cacheKey: 'projectd@track@@global' });
  assert.deepEqual(parsePlayerScopeKey(player), { cacheKey: 'steam@projectd@track@@car' });
});

test('isHudUpdateScopeKey accepts battle board and player keys', () => {
  assert.equal(isHudUpdateScopeKey('battle:testing:76561199000000001'), true);
  assert.equal(isHudUpdateScopeKey('board:projectd@track@@global'), true);
  assert.equal(isHudUpdateScopeKey('player:steam@projectd@track@@car'), true);
  assert.equal(isHudUpdateScopeKey('lb:legacy'), false);
});
