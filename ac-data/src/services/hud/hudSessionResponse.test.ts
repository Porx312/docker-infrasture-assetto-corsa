import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSessionVpsResponse,
  mapMissingProfilePlayer,
  mapSessionResultToPlayer,
} from './hudSessionResponse.js';
import type { HudSessionOk } from './hudTypes.js';

const sessionOk: HudSessionOk = {
  ok: true,
  version: '1719061234567',
  context: {
    server_id: '',
    server_name: 'testing',
    track_id: 'pk_akina',
    track_name: 'Pk Akina',
    layout_id: 'akina_downhill',
    layout_name: 'Akina Downhill',
    car_id: 'ks_toyota_gt86',
    car_name: 'Toyota GT86',
    player_steam_id: '76561198000000002',
  },
  profile: {
    name: 'Driver',
    rank: 5,
    tier: 7,
    best_lap_ms: 290_000,
    car_name: 'Toyota GT86',
    car_id: 'ks_toyota_gt86',
    steam_id: '76561198000000002',
    elo: 1520,
    isInvalidated: false,
    rivals: {
      above: {
        rank: 4,
        name: 'Rival Above',
        tier: 7,
        lap_ms: 289_500,
        car_name: 'Toyota GT86',
      },
      below: null,
    },
  },
};

test('buildSessionVpsResponse returns players without leaderboard', () => {
  const players = [mapMissingProfilePlayer('76561198000000099')];
  const response = buildSessionVpsResponse('100:200', players);

  assert.equal(response.ok, true);
  assert.equal(response.version, '100:200');
  assert.equal(response.players.length, 1);
  assert.equal(response.players[0]?.profile, null);
  assert.equal('leaderboard' in response, false);
});

test('mapSessionResultToPlayer maps context and rivals profile', () => {
  const player = mapSessionResultToPlayer('76561198000000002', sessionOk);

  assert.equal(player.profile?.name, 'Driver');
  assert.equal(player.profile?.rivals.above?.name, 'Rival Above');
  assert.equal(player.context?.track_id, 'pk_akina');
  assert.equal(player.context?.car_id, 'ks_toyota_gt86');
});

test('mapSessionResultToPlayer handles failed session as missing profile', () => {
  const player = mapSessionResultToPlayer('76561198000000099', {
    ok: false,
    reason: 'user_not_found',
  });

  assert.deepEqual(player, mapMissingProfilePlayer('76561198000000099'));
});
