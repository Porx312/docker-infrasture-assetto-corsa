import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapProfileToBattlePlayer,
  normalizeBattlePlayerSnapshot,
} from './battleHudReader.js';
import type { HudProfile } from './hudTypes.js';

const profile: HudProfile = {
  name: 'Profile Name',
  rank: 3,
  tier: 8,
  best_lap_ms: 120_000,
  car_name: 'Toyota GT86',
  car_id: 'ks_toyota_gt86',
  avatar_url: 'https://example.com/avatar.png',
  steam_id: 'steam-a',
  elo: 1540,
  rivals: { above: null, below: null },
};

test('normalizeBattlePlayerSnapshot maps legacy car to car_id', () => {
  const normalized = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car: 'ks_toyota_gt86',
    score: 1,
    role: 'lead',
  });

  assert.equal(normalized.car_id, 'ks_toyota_gt86');
  assert.equal(normalized.car_name, 'ks_toyota_gt86');
  assert.equal(normalized.tier, 0);
  assert.equal(normalized.role, 'lead');
});

test('mapProfileToBattlePlayer prefers profile fields', () => {
  const base = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car_id: 'legacy_car',
    score: 2,
  });

  const merged = mapProfileToBattlePlayer(base, profile);

  assert.equal(merged.name, 'Profile Name');
  assert.equal(merged.tier, 8);
  assert.equal(merged.elo, 1540);
  assert.equal(merged.avatar_url, 'https://example.com/avatar.png');
  assert.equal(merged.car_id, 'ks_toyota_gt86');
  assert.equal(merged.car_name, 'Toyota GT86');
  assert.equal(merged.score, 2);
});

test('mapProfileToBattlePlayer keeps snapshot when profile is null', () => {
  const base = normalizeBattlePlayerSnapshot({
    steamId: 'steam-b',
    name: 'Bob',
    car: 'ks_mazda_miata',
    score: 0,
  });

  const merged = mapProfileToBattlePlayer(base, null);

  assert.equal(merged.name, 'Bob');
  assert.equal(merged.tier, 0);
  assert.equal(merged.avatar_url, undefined);
  assert.equal(merged.car_id, 'ks_mazda_miata');
});
