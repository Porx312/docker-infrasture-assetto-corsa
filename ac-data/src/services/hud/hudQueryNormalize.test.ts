import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeHudQuery,
  normalizeHudServerName,
  normalizeHudTrack,
} from './hudQueryNormalize.js';

test('normalizeHudServerName strips CM suffix', () => {
  assert.equal(
    normalizeHudServerName(
      'ProjectD |Akina Downhill | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6qf ℹ18081',
    ),
    'ProjectD |Akina Downhill | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6qf',
  );
});

test('normalizeHudTrack splits combined AC track id', () => {
  assert.deepEqual(normalizeHudTrack('pk_akina-akina_downhill'), {
    track: 'pk_akina',
    trackConfig: 'akina_downhill',
  });
  assert.deepEqual(normalizeHudTrack('ek_happogahara-outbound_real'), {
    track: 'ek_happogahara',
    trackConfig: 'outbound_real',
  });
});

test('normalizeHudTrack preserves explicit trackConfig', () => {
  assert.deepEqual(normalizeHudTrack('pk_akina', 'akina_downhill'), {
    track: 'pk_akina',
    trackConfig: 'akina_downhill',
  });
});

test('normalizeHudQuery applies both normalizers', () => {
  assert.deepEqual(
    normalizeHudQuery(
      'ProjectD |Akina ℹ18081',
      'pk_akina-akina_downhill',
    ),
    {
      serverName: 'ProjectD |Akina',
      track: 'pk_akina',
      trackConfig: 'akina_downhill',
    },
  );
});
