import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWsMessage, writeWsEvent } from './hudWsFormat.js';
import { isHudWsEnabled } from './battleHudPush.js';
import { normalizeHudProfile } from './hudProfile.js';
import {
  buildHudSessionEvent,
  buildHudVersionEvent,
  resetHudPushConnectionsForTests,
  versionFingerprint,
} from './hudPushHub.js';

test('formatWsMessage serializes event envelope', () => {
  const formatted = formatWsMessage('hud_session', {
    steamId: '76561199000000001',
    ok: true,
    version: 'v1',
  });
  const parsed = JSON.parse(formatted) as { event: string; data: { ok: boolean } };
  assert.equal(parsed.event, 'hud_session');
  assert.equal(parsed.data.ok, true);
});

test('writeWsEvent sends JSON frame', () => {
  const frames: string[] = [];
  writeWsEvent((payload) => frames.push(payload), 'battle', { ok: true, state: 'active' });
  assert.equal(frames.length, 1);
  const parsed = JSON.parse(frames[0] ?? '') as { event: string; data: { state: string } };
  assert.equal(parsed.event, 'battle');
  assert.equal(parsed.data.state, 'active');
});

test('isHudWsEnabled defaults true unless HUD_WS_ENABLED=false', () => {
  const prev = process.env.HUD_WS_ENABLED;
  delete process.env.HUD_WS_ENABLED;
  try {
    assert.equal(isHudWsEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.HUD_WS_ENABLED;
    else process.env.HUD_WS_ENABLED = prev;
  }
});

test('buildHudVersionEvent includes version fields', () => {
  const payload = buildHudVersionEvent('76561199000000001', {
    ok: true,
    version: 'a:b:c:1:2:3:4:5',
    lbVersion: 'a:b:c:1:2:3:4',
    playerVersion: 123,
  });
  assert.deepEqual(payload, {
    steamId: '76561199000000001',
    version: 'a:b:c:1:2:3:4:5',
    lbVersion: 'a:b:c:1:2:3:4',
    playerVersion: 123,
  });
});

test('buildHudSessionEvent normalizes profile fields', () => {
  const payload = buildHudSessionEvent('76561199000000001', {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'testing xd',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: '76561199000000001',
    },
    profile: normalizeHudProfile({
      name: 'Alice',
      rank: 84,
      tier: 7,
      bestLapMs: 275_432,
      carName: 'AE86',
      carId: 'ae86',
      steamId: '76561199000000001',
      rivals: { above: null, below: null },
    }),
  });

  assert.equal(payload.steamId, '76561199000000001');
  assert.equal((payload.profile as { best_lap_ms: number }).best_lap_ms, 275_432);
});

test('versionFingerprint tracks lb and player version', () => {
  assert.equal(
    versionFingerprint({
      ok: true,
      version: 'v',
      lbVersion: 'lb',
      playerVersion: 1,
    }),
    'v|lb|1',
  );
  resetHudPushConnectionsForTests();
});
