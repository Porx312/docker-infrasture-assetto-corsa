import assert from 'node:assert/strict';
import test from 'node:test';

import { isProfileInvalidated } from './hudProfile.js';
import type { HudProfile } from './hudTypes.js';

const validProfile: HudProfile = {
  name: 'Alice',
  rank: 1,
  tier: 5,
  best_lap_ms: 100_000,
  car_name: 'AE86',
  car_id: 'ae86',
  steam_id: '76561199000000001',
  rivals: { above: null, below: null },
};

test('isProfileInvalidated is false for normal profile', () => {
  assert.equal(isProfileInvalidated(validProfile), false);
  assert.equal(isProfileInvalidated({ ...validProfile, isInvalidated: false }), false);
});

test('isProfileInvalidated is true when flagged', () => {
  assert.equal(isProfileInvalidated({ ...validProfile, isInvalidated: true }), true);
});

test('isProfileInvalidated is false for null profile', () => {
  assert.equal(isProfileInvalidated(null), false);
  assert.equal(isProfileInvalidated(undefined), false);
});
