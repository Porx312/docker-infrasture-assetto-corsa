import assert from 'node:assert/strict';
import test from 'node:test';

import {
  battleRoomFromCacheKey,
  battleRoomFromParams,
  isBattleScopeKey,
  parseBattleScopeKey,
} from './hudBattleRooms.js';

test('battleRoomFromParams matches telemetry scopeKey format', () => {
  const room = battleRoomFromParams('Battle Test', '76561199000000001');
  assert.equal(room, 'battle:battle_test:76561199000000001');
});

test('parseBattleScopeKey round-trips cache params', () => {
  const room = battleRoomFromCacheKey('testing:76561199000000001');
  assert.ok(isBattleScopeKey(room));
  assert.deepEqual(parseBattleScopeKey(room), {
    serverName: 'testing',
    steamId: '76561199000000001',
  });
});

test('parseBattleScopeKey rejects non-battle keys', () => {
  assert.equal(parseBattleScopeKey('lb:foo'), null);
  assert.equal(parseBattleScopeKey('battle:invalid'), null);
});
