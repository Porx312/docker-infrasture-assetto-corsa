import assert from 'node:assert/strict';
import test from 'node:test';

import { isProfileInvalidated, normalizeHudProfile, playerResultFromSession } from './hudProfile.js';
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
  assert.equal(
    isProfileInvalidated(normalizeHudProfile({ ...validProfile, is_invalidated: true })!),
    true,
  );
});

test('isProfileInvalidated is false for null profile', () => {
  assert.equal(isProfileInvalidated(null), false);
  assert.equal(isProfileInvalidated(undefined), false);
});

test('playerResultFromSession derives player profile from session ok', () => {
  const derived = playerResultFromSession({
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'testing',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ks_toyota_gt86',
      car_name: 'GT86',
      player_steam_id: validProfile.steam_id,
    },
    profile: validProfile,
  });
  assert.equal(derived.ok, true);
  if (derived.ok) {
    assert.equal(derived.profile?.rank, 1);
    assert.equal(derived.profile?.tier, 5);
  }
});

test('playerResultFromSession maps session errors to player errors', () => {
  assert.deepEqual(playerResultFromSession({ ok: false, reason: 'user_invalidated' }), {
    ok: false,
    reason: 'user_invalidated',
  });
  assert.deepEqual(playerResultFromSession({ ok: false, reason: 'car_not_found' }), {
    ok: false,
    reason: 'track_not_found',
  });
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

test('coerceHudProfile preserves display_style, frame_url, and input_type', () => {
  const normalized = normalizeHudProfile({
    name: 'Alice',
    rank: 12,
    tier: 7,
    best_lap_ms: 275_432,
    car_name: 'Trueno AE86',
    car_id: 'ae86',
    steam_id: '76561199000000001',
    displayStyle: {
      fontId: 'orbitron',
      effectId: 'gradient',
      color: '#FFFFFF',
      gradientColor: '#FF4530',
      weight: 'bold',
      letterSpacing: 'wide',
    },
    frameUrl: 'https://cdn.example.com/frames/gold.png',
    inputType: 'wheel',
    rivals: {
      above: {
        rank: 11,
        name: 'Bob',
        tier: 8,
        lap_ms: 275_100,
        car_name: 'RX-7',
        display_style: {
          fontId: 'teko',
          effectId: 'solid',
          color: '#00FFAA',
        },
        frame_url: 'https://cdn.example.com/frames/silver.png',
        input_type: 'controller',
      },
      below: null,
    },
  });

  assert.equal(normalized?.display_style?.fontId, 'orbitron');
  assert.equal(normalized?.display_style?.effectId, 'gradient');
  assert.equal(normalized?.display_style?.gradientColor, '#FF4530');
  assert.equal(normalized?.frame_url, 'https://cdn.example.com/frames/gold.png');
  assert.equal(normalized?.input_type, 'wheel');
  assert.equal(normalized?.rivals.above?.display_style?.fontId, 'teko');
  assert.equal(normalized?.rivals.above?.frame_url, 'https://cdn.example.com/frames/silver.png');
  assert.equal(normalized?.rivals.above?.input_type, 'controller');
});

test('normalizeHudProfile defaults saveTime and acceptBattle to true', () => {
  const normalized = normalizeHudProfile({
    ...validProfile,
    rivals: { above: null, below: null },
  });
  assert.equal(normalized?.saveTime, true);
  assert.equal(normalized?.acceptBattle, true);
});

test('normalizeHudProfile parses explicit saveTime and acceptBattle false', () => {
  const normalized = normalizeHudProfile({
    ...validProfile,
    saveTime: false,
    acceptBattle: false,
    save_time: true,
    accept_battle: true,
  });
  assert.equal(normalized?.saveTime, false);
  assert.equal(normalized?.acceptBattle, false);
});

test('normalizeHudProfile accepts snake_case prefs', () => {
  const normalized = normalizeHudProfile({
    ...validProfile,
    save_time: false,
    accept_battle: false,
  });
  assert.equal(normalized?.saveTime, false);
  assert.equal(normalized?.acceptBattle, false);
});
