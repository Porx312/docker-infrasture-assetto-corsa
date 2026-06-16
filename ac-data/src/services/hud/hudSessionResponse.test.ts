import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlayerContext,
  buildSessionVpsResponse,
  mapPlayerResultToSessionPlayer,
  mapMissingProfilePlayer,
} from './hudSessionResponse.js';
import type { HudTop10Ok } from './hudTypes.js';

const top10: HudTop10Ok = {
  ok: true,
  version: 'srv:pk_akina:akina_downhill:123',
  server_name: 'ProjectD |Akina',
  track_name: 'Pk Akina',
  layout_id: 'akina_downhill',
  layout_name: 'Akina Downhill',
  car_filter: 'global',
  filters: [{ id: 'global', label: 'Global ranking' }],
  entries: [
    {
      rank: 1,
      name: 'Takumi',
      tier: 9,
      lap_ms: 279650,
      car_name: 'Toyota AE86',
      car_id: 'ks_toyota_ae86',
      steam_id: '76561198000000001',
    },
  ],
};

test('buildSessionVpsResponse always includes players from top10', () => {
  const players = [mapMissingProfilePlayer('76561198000000002')];
  const response = buildSessionVpsResponse(top10, players);

  assert.equal(response.ok, true);
  assert.equal(response.leaderboard.entries.length, 1);
  assert.equal(response.players.length, 1);
  assert.equal(response.players[0]?.profile, null);
});

test('mapPlayerResultToSessionPlayer maps profile and rival', () => {
  const player = mapPlayerResultToSessionPlayer('76561198000000002', top10, 'pk_akina', 'ks_toyota_ae86', {
    ok: true,
    profile: {
      name: 'Driver',
      rank: 5,
      tier: 7,
      best_lap_ms: 290000,
      car_name: 'Toyota AE86',
      car_id: 'ks_toyota_ae86',
      steam_id: '76561198000000002',
      rival: {
        rank: 4,
        name: 'Rival',
        tier: 7,
        lap_ms: 289500,
        car_name: 'Toyota AE86',
      },
    },
    times_on_track: [],
    global_times: [],
  });

  assert.equal(player.profile?.name, 'Driver');
  assert.equal(player.profile?.rival?.name, 'Rival');
  assert.equal(player.context?.track_id, 'pk_akina');
  assert.equal(player.context?.car_id, 'ks_toyota_ae86');
});

test('mapPlayerResultToSessionPlayer handles user_not_found', () => {
  const player = mapPlayerResultToSessionPlayer('76561198000000099', top10, 'pk_akina', undefined, {
    ok: false,
    reason: 'user_not_found',
  });

  assert.deepEqual(player, mapMissingProfilePlayer('76561198000000099'));
});

test('buildPlayerContext falls back to carModel when profile is null', () => {
  const context = buildPlayerContext(top10, '76561198000000002', 'pk_akina', 'ks_toyota_ae86', null);

  assert.equal(context.car_id, 'ks_toyota_ae86');
  assert.equal(context.track_name, 'Pk Akina');
});
