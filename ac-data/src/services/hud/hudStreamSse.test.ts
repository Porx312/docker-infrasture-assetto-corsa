import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSseEvent } from './hudStreamSseFormat.js';
import { normalizeHudProfile } from './hudProfile.js';
import {
  buildHudSessionEvent,
  buildHudVersionEvent,
  resetHudSseConnectionsForTests,
  versionFingerprint,
} from './hudSsePush.js';

test('formatSseEvent serializes hud_session payload', () => {
  const formatted = formatSseEvent('hud_session', {
    steamId: '76561199000000001',
    ok: true,
    version: 'v1',
    context: null,
    profile: null,
  });
  assert.match(formatted, /^event: hud_session\n/);
});

test('formatSseEvent serializes battle payload', () => {
  const formatted = formatSseEvent('battle', { ok: true, version: '1', state: 'active' });
  assert.equal(
    formatted,
    'event: battle\ndata: {"ok":true,"version":"1","state":"active"}\n\n',
  );
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
  resetHudSseConnectionsForTests();
});
