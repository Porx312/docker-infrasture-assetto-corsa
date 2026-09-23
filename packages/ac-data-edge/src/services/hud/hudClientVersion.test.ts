import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHudVersionForSession, fnv1aHash32 } from './hudClientVersion.js';
import type { HudSessionOk } from './hudTypes.js';

const steamId = '76561199000000001';

function sampleSession(version = 'server:track:car:1'): HudSessionOk {
  return {
    ok: true,
    version,
    context: {
      server_id: 's1',
      server_name: 'Testing',
      track_id: 'pk_test',
      track_name: 'Test',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };
}

test('fnv1aHash32 is stable for the same input', () => {
  assert.equal(fnv1aHash32('a|b|c'), fnv1aHash32('a|b|c'));
  assert.notEqual(fnv1aHash32('a|b|c'), fnv1aHash32('a|b|d'));
});

test('buildHudVersionForSession returns same playerVersion for unchanged session', () => {
  const session = sampleSession();
  const a = buildHudVersionForSession(session, 'cosmetics-fp');
  const b = buildHudVersionForSession(session, 'cosmetics-fp');
  assert.equal(a.playerVersion, b.playerVersion);
  assert.equal(a.version, session.version);
  assert.equal(a.lbVersion, session.version);
});

test('buildHudVersionForSession changes playerVersion when session.version changes', () => {
  const fp = 'same-fp';
  const v1 = buildHudVersionForSession(sampleSession('v1'), fp);
  const v2 = buildHudVersionForSession(sampleSession('v2'), fp);
  assert.notEqual(v1.playerVersion, v2.playerVersion);
});

test('buildHudVersionForSession changes playerVersion when cosmetics fp changes', () => {
  const session = sampleSession();
  const v1 = buildHudVersionForSession(session, 'fp-a');
  const v2 = buildHudVersionForSession(session, 'fp-b');
  assert.notEqual(v1.playerVersion, v2.playerVersion);
});
