import assert from 'node:assert/strict';
import test from 'node:test';

import { battleInstanceId, buildBattleServerKey } from './hudBattleServerKey.js';

function withInstanceId(instanceId: string | undefined, fn: () => void): void {
  const prev = process.env.AC_INSTANCE_ID;
  if (instanceId === undefined) {
    delete process.env.AC_INSTANCE_ID;
  } else {
    process.env.AC_INSTANCE_ID = instanceId;
  }
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

test('battleInstanceId falls back to default when unset', () => {
  withInstanceId(undefined, () => {
    assert.equal(battleInstanceId(), 'default');
  });
});

test('buildBattleServerKey prefixes instance and normalizes display name', () => {
  withInstanceId('vps-eu-2', () => {
    assert.equal(buildBattleServerKey('Battle Test'), 'vps-eu-2_battle_test');
    assert.equal(buildBattleServerKey('Project D'), 'vps-eu-2_project_d');
  });
});
