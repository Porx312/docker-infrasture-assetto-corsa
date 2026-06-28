import assert from 'node:assert/strict';
import test from 'node:test';

import { isProfileInvalidated, mergeSessionProfileFields, normalizeHudProfile } from './hudProfile.js';
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

const rivalAbove = {
  rank: 2,
  name: 'Bob',
  tier: 6,
  lap_ms: 99_000,
  car_name: 'RX-7',
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

test('normalizeHudProfile mirrors rivals.above to rival', () => {
  const normalized = normalizeHudProfile({
    ...validProfile,
    rivals: { above: rivalAbove, below: null },
  });

  assert.deepEqual(normalized?.rival, rivalAbove);
});

test('normalizeHudProfile keeps explicit rival when rivals.above is null', () => {
  const explicitRival = { ...rivalAbove, name: 'Legacy' };
  const normalized = normalizeHudProfile({
    ...validProfile,
    rival: explicitRival,
    rivals: { above: null, below: null },
  });

  assert.equal(normalized?.rival?.name, 'Legacy');
});

test('normalizeHudProfile prefers rivals.above over stale rival field', () => {
  const normalized = normalizeHudProfile({
    ...validProfile,
    rival: { ...rivalAbove, name: 'Stale' },
    rivals: { above: rivalAbove, below: null },
  });

  assert.equal(normalized?.rival?.name, 'Bob');
});

test('coerceHudProfile maps camelCase Convex fields', () => {
  const normalized = normalizeHudProfile({
    name: 'Alice',
    rank: 12,
    tier: 7,
    bestLapMs: 275_432,
    carName: 'Trueno AE86',
    carId: 'ae86',
    steamId: '76561199000000001',
    rivals: {
      above: {
        rank: 11,
        name: 'Bob',
        tier: 8,
        lapMs: 275_100,
        carName: 'RX-7',
      },
      below: null,
    },
  });

  assert.equal(normalized?.best_lap_ms, 275_432);
  assert.equal(normalized?.tier, 7);
  assert.equal(normalized?.car_id, 'ae86');
  assert.equal(normalized?.rivals.above?.lap_ms, 275_100);
});

test('mergeSessionProfileFields prefers player tier and best_lap_ms', () => {
  const merged = mergeSessionProfileFields(
    {
      name: 'Alice',
      rank: 84,
      tier: 0,
      best_lap_ms: 0,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: '76561199000000001',
      rivals: { above: rivalAbove, below: null },
    },
    {
      name: 'Alice',
      rank: 0,
      tier: 7,
      best_lap_ms: 275_432,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: '76561199000000001',
      rivals: { above: null, below: null },
    },
  );

  assert.equal(merged?.tier, 7);
  assert.equal(merged?.best_lap_ms, 275_432);
  assert.equal(merged?.rank, 84);
  assert.equal(merged?.rivals.above?.name, 'Bob');
});
