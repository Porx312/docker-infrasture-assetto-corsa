import assert from 'node:assert/strict';
import test from 'node:test';

import {
  overlaySessionContextFromPresence,
  sessionCacheCarMismatch,
  sessionCacheTrackMismatch,
  setHudSessionPresenceTestHooks,
  shouldBypassJoinRefreshDedupe,
  shouldBypassSessionCacheForPresence,
  shouldRefreshJoinContextForPresence,
  sessionContextServerName,
} from '../../../src/services/hud/hudSessionPresence.js';
import {
  resetManagedServersForTests,
  updateManagedServersFromSnapshot,
} from '../../../src/services/hud/hudManagedServers.js';
import type { HudSessionOk } from '@projectd/ac-data-shared/services/hud/hudTypes.js';

const steamId = '76561199000000001';

test('shouldRefreshJoinContextForPresence returns true when cache missing', async () => {
  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => null,
  });
  try {
    assert.equal(await shouldRefreshJoinContextForPresence(steamId, 'Battle'), true);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldRefreshJoinContextForPresence returns false when cache hit and servers match', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => '',
  });
  try {
    assert.equal(await shouldRefreshJoinContextForPresence(steamId, 'Gunsai Testing'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldRefreshJoinContextForPresence returns true when presence server differs from cache', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => '',
  });
  try {
    assert.equal(await shouldRefreshJoinContextForPresence(steamId, 'Battle'), true);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldBypassSessionCacheForPresence returns false when cache missing', async () => {
  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => null,
  });
  try {
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Battle'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldBypassSessionCacheForPresence returns false when servers match', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => '',
  });
  try {
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Gunsai Testing'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldBypassSessionCacheForPresence returns true when presence server differs from cache', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => '',
  });
  try {
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Battle'), true);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('sessionContextServerName normalizes cached session server name', () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: '  Battle  ',
      track_id: 'pk_battle',
      track_name: 'Battle',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  assert.equal(sessionContextServerName(session), 'Battle');
});

test('shouldRefreshJoinContextForPresence returns true when presence car differs from cache', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ks_mazda_rx7',
      car_name: 'RX7',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'RX7',
      car_id: 'ks_mazda_rx7',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => '',
  });
  try {
    assert.equal(
      await shouldRefreshJoinContextForPresence(steamId, 'Gunsai Testing', 'ks_mazda_miata'),
      true,
    );
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldBypassJoinRefreshDedupe returns true when cached car differs from presence', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ks_mazda_rx7',
      car_name: 'RX7',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'RX7',
      car_id: 'ks_mazda_rx7',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => 'ks_mazda_miata',
  });
  try {
    assert.equal(await shouldBypassJoinRefreshDedupe(steamId), true);
    assert.equal(sessionCacheCarMismatch(session, 'ks_mazda_miata'), true);
    assert.equal(sessionCacheCarMismatch(session, 'ks_mazda_rx7'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldRefreshJoinContextForPresence returns false when names differ but folderSlug matches', async () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    {
      serverName: 'server-1',
      displayName: 'My Lobby Display Name',
      type: 'time-attack',
    },
  ]);

  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'My Lobby Display Name',
      track_id: 'pk_test',
      track_name: 'Test',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => '',
  });
  try {
    assert.equal(
      await shouldRefreshJoinContextForPresence(steamId, 'Server-1 ℹ18081'),
      false,
    );
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Server-1 ℹ18081'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
    resetManagedServersForTests();
  }
});

test('sessionCacheTrackMismatch detects stale session track vs presence', () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Porx',
      track_id: 'pk_tail_of_the_dragon',
      track_name: 'Tail',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: null,
  };

  assert.equal(sessionCacheTrackMismatch(session, 'sakanotsuji', 'downhill_grip'), true);
  assert.equal(
    sessionCacheTrackMismatch(session, 'csp/3465/../pk_tail_of_the_dragon', ''),
    false,
  );
  assert.equal(sessionCacheTrackMismatch(session, '', 'downhill_grip'), false);
});

test('shouldBypassSessionCacheForPresence returns true when presence track differs', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Porx',
      track_id: 'pk_tail_of_the_dragon',
      track_name: 'Tail',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => session,
    readPresenceCarModel: async () => 'ae86',
    readPresenceTrack: async () => ({ track: 'sakanotsuji', trackConfig: 'downhill_grip' }),
  });
  try {
    assert.equal(
      await shouldBypassSessionCacheForPresence(steamId, 'Porx', {
        track: 'sakanotsuji',
        trackConfig: 'downhill_grip',
      }),
      true,
    );
    assert.equal(
      await shouldRefreshJoinContextForPresence(steamId, 'Porx', {
        track: 'sakanotsuji',
        trackConfig: 'downhill_grip',
      }),
      true,
    );
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('overlaySessionContextFromPresence patches stale track from presence', () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Porx',
      track_id: 'pk_tail_of_the_dragon',
      track_name: 'Tail',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: null,
  };

  const patched = overlaySessionContextFromPresence(session, {
    track: 'csp/3465/../sakanotsuji',
    trackConfig: 'downhill_grip',
  });
  assert.equal(patched.context.track_id, 'sakanotsuji');
  assert.equal(patched.context.layout_id, 'downhill_grip');
  assert.equal(session.context.track_id, 'pk_tail_of_the_dragon');
});
