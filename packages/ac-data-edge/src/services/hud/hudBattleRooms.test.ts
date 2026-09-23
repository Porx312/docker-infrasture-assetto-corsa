import assert from 'node:assert/strict';
import test from 'node:test';

import {
  battleRoomFromCacheKey,
  battleRoomFromParams,
  isBattleScopeKey,
  parseBattleScopeKey,
} from './hudBattleRooms.js';

function withInstanceId(instanceId: string, fn: () => void): void {
  const prev = process.env.AC_INSTANCE_ID;
  process.env.AC_INSTANCE_ID = instanceId;
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env.AC_INSTANCE_ID;
    } else {
      process.env.AC_INSTANCE_ID = prev;
    }
  }
}

test('battleRoomFromParams matches telemetry scopeKey format', () => {
  withInstanceId('vps-eu-1', () => {
    const room = battleRoomFromParams('Battle Test', '76561199000000001');
    assert.equal(room, 'battle:vps-eu-1_battle_test:76561199000000001');
  });
});

test('parseBattleScopeKey round-trips cache params', () => {
  const room = battleRoomFromCacheKey('vps-eu-1_testing:76561199000000001');
  assert.ok(isBattleScopeKey(room));
  assert.deepEqual(parseBattleScopeKey(room), {
    serverName: 'vps-eu-1_testing',
    steamId: '76561199000000001',
  });
});

test('parseBattleScopeKey rejects non-battle keys', () => {
  assert.equal(parseBattleScopeKey('lb:foo'), null);
  assert.equal(parseBattleScopeKey('battle:invalid'), null);
});
