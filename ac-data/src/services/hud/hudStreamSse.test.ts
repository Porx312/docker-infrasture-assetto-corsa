import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionVpsResponse } from './hudSessionResponse.js';
import { formatSseEvent } from './hudStreamSse.js';
import { normalizeHudProfile } from './hudProfile.js';

test('formatSseEvent serializes event and JSON data', () => {
  const formatted = formatSseEvent('battle:update', { ok: true, version: '1', state: 'active' });
  assert.equal(
    formatted,
    'event: battle:update\ndata: {"ok":true,"version":"1","state":"active"}\n\n',
  );
});

test('formatSseEvent handles session:update payload', () => {
  const formatted = formatSseEvent('session:update', { ok: true, version: '1:2', players: [] });
  assert.match(formatted, /^event: session:update\n/);
});

test('formatSseEvent handles battle:clear payload', () => {
  const formatted = formatSseEvent('battle:clear', { ok: false, reason: 'no_battle' });
  assert.match(formatted, /^event: battle:clear\n/);
  assert.match(formatted, /"reason":"no_battle"/);
});

test('session:update SSE includes tier and best_lap_ms in profile', () => {
  const profile = normalizeHudProfile({
    name: 'Alice',
    rank: 84,
    tier: 7,
    bestLapMs: 275_432,
    carName: 'AE86',
    carId: 'ae86',
    steamId: '76561199000000001',
    rivals: { above: null, below: null },
  });
  assert.ok(profile);

  const payload = buildSessionVpsResponse('1:2', [
    {
      steamId: '76561199000000001',
      ok: true,
      context: null,
      profile,
    },
  ]);

  const formatted = formatSseEvent('session:update', payload);
  assert.match(formatted, /"tier":7/);
  assert.match(formatted, /"best_lap_ms":275432/);
});
