import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRivalSlot,
  needsRankRecompute,
  patchRivalLapInProfile,
  rivalMatchesAuthor,
} from './hudRivalLocalPatch.js';
import type { HudProfile } from './hudTypes.js';

const baseProfile: HudProfile = {
  name: 'Observer',
  rank: 5,
  tier: 3,
  best_lap_ms: 280_000,
  car_name: 'GT86',
  car_id: 'ks_toyota_gt86',
  steam_id: '76561199000000002',
  rivals: {
    above: {
      rank: 4,
      name: 'Porx',
      tier: 4,
      lap_ms: 275_000,
      car_name: 'RX7',
    },
    below: {
      rank: 6,
      name: 'Minty',
      tier: 2,
      lap_ms: 285_000,
      car_name: 'GT86',
    },
  },
};

test('rivalMatchesAuthor matches by name', () => {
  assert.equal(rivalMatchesAuthor(baseProfile.rivals.above, '76561199000000001', 'Porx'), true);
  assert.equal(rivalMatchesAuthor(baseProfile.rivals.above, '76561199000000001', 'Other'), false);
});

test('findRivalSlot locates above rival', () => {
  assert.equal(findRivalSlot(baseProfile, '76561199000000001', 'Porx'), 'above');
  assert.equal(findRivalSlot(baseProfile, '76561199000000001', 'Unknown'), null);
});

test('patchRivalLapInProfile updates rival lap when PB improves', () => {
  const patched = patchRivalLapInProfile(baseProfile, 'above', 274_000);
  assert.ok(patched);
  assert.equal(patched?.rivals.above?.lap_ms, 274_000);
});

test('patchRivalLapInProfile skips when lap is slower than cached rival PB', () => {
  const patched = patchRivalLapInProfile(baseProfile, 'above', 276_000);
  assert.equal(patched, null);
});

test('needsRankRecompute when outsider PB beats observer best', () => {
  assert.equal(needsRankRecompute(baseProfile, '76561199000000099', 'Stranger', 279_000), true);
});

test('needsRankRecompute false when rival in window improves own PB', () => {
  assert.equal(needsRankRecompute(baseProfile, '76561199000000001', 'Porx', 274_500), false);
});
