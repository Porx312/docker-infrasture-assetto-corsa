import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import { buildSessionCacheKey, sessionRedisKey, ssePresenceRedisKey } from './hudCacheKeys.js';
import { formatSseEvent } from './hudStreamSseFormat.js';
import { buildHudSessionEvent, buildHudVersionEvent } from './hudSsePush.js';
import { normalizeHudProfile } from './hudProfile.js';
import { handleHudSnapshot } from './hudSnapshot.js';
import { isHudConvexConfigured } from './hudConvex.js';
import { resetManagedServersForTests, updateManagedServersFromSnapshot } from './hudManagedServers.js';
import {
  buildPresenceRecordForTests,
  registerBattleSsePresence,
  resetBattleSsePresenceForTests,
} from './hudPlayerPresence.js';
import { clearHudSsePresence } from './hudSsePresence.js';
import { HUD_SESSION_TTL_SEC, hudRedisDel, hudRedisGet, hudRedisSet, isHudRedisConfigured } from './hudRedis.js';
import {
  resetConvexClientForTests,
  setConvexClientForTests,
} from '../convexClient.js';

test('snapshot JSON session field matches SSE hud_session event shape', () => {
  const steamId = '76561199000000001';
  const session = buildHudSessionEvent(steamId, {
    ok: true,
    version: 'server:track:layout:car:1',
    context: {
      server_id: 's1',
      server_name: 'testing xd',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: normalizeHudProfile({
      name: 'Alice',
      rank: 12,
      tier: 7,
      bestLapMs: 275_432,
      lastLapMs: 276_100,
      carName: 'AE86',
      carId: 'ae86',
      steamId,
      rivals: { above: null, below: null },
    }),
  });

  const sseLine = formatSseEvent('hud_session', session);
  assert.match(sseLine, /^event: hud_session\n/);
  assert.match(sseLine, /"best_lap_ms":275432/);
  assert.match(sseLine, /"last_lap_ms":276100/);

  const snapshotPayload = {
    ok: true,
    steamId,
    version: buildHudVersionEvent(steamId, {
      ok: true,
      version: 'server:track:layout:car:1',
      lbVersion: 'server:track:layout:car:1',
      playerVersion: 1,
    }),
    session,
    battle: { ok: false, reason: 'no_battle' },
  };

  assert.equal(snapshotPayload.session, session);
  assert.deepEqual(Object.keys(snapshotPayload.session ?? {}), [
    'steamId',
    'ok',
    'version',
    'context',
    'profile',
  ]);
});

test('snapshot battle field uses same event name as SSE (battle)', () => {
  const battle = { ok: true, version: '1', state: 'active' };
  const sseLine = formatSseEvent('battle', battle);
  assert.equal(sseLine, formatSseEvent('battle', battle));
  assert.match(sseLine, /^event: battle\n/);
});

test('handleHudSnapshot returns 404 with convex_unreachable when Convex fetch fails', async () => {
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return;
  }

  const steamId = '76561199000000998';
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    {
      serverName: 'server',
      displayName: 'testing xd',
      type: 'testing',
    },
  ]);

  const record = buildPresenceRecordForTests(
    'testing xd',
    { trackName: 'pk_akina', trackConfig: 'downhill' },
    steamId,
    'ks_toyota_gt86',
  );
  registerBattleSsePresence({
    steamId,
    ...record,
    serverType: 'testing',
    folderSlug: 'server',
  });

  setConvexClientForTests({
    query: async () => {
      throw new TypeError('fetch failed', { cause: new Error('read ECONNRESET') });
    },
    mutation: async () => {
      throw new TypeError('fetch failed');
    },
  });

  let statusCode = 0;
  let body: unknown;
  const req = {
    query: { steamId },
  } as unknown as Request;
  const res = {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
    },
  } as unknown as Response;

  try {
    await handleHudSnapshot(req, res);
    assert.equal(statusCode, 404);
    assert.deepEqual(body, { ok: false, reason: 'convex_unreachable' });
  } finally {
    resetConvexClientForTests();
    resetBattleSsePresenceForTests();
    resetManagedServersForTests();
  }
});

test('handleHudSnapshot marks overlay presence on successful poll', async () => {
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return;
  }

  const steamId = '76561199000000997';
  const sessionVersion = 'server:track:layout:car:poll-test';

  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    {
      serverName: 'server',
      displayName: 'testing xd',
      type: 'battle',
    },
  ]);

  const record = buildPresenceRecordForTests(
    'testing xd',
    { trackName: 'pk_akina', trackConfig: 'downhill' },
    steamId,
    'ks_toyota_gt86',
  );
  registerBattleSsePresence({
    steamId,
    ...record,
    serverType: 'battle',
    folderSlug: 'server',
  });

  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisSet(
    sessionKey,
    JSON.stringify({
      ok: true,
      version: sessionVersion,
      context: {
        server_id: 's1',
        server_name: 'testing xd',
        track_id: 'pk_akina',
        track_name: 'Akina',
        layout_id: 'downhill',
        layout_name: 'Downhill',
        car_id: 'ks_toyota_gt86',
        car_name: 'GT86',
        player_steam_id: steamId,
      },
      profile: null,
    }),
    HUD_SESSION_TTL_SEC,
  );

  const sseKey = ssePresenceRedisKey(steamId);
  await clearHudSsePresence(steamId);

  setConvexClientForTests({
    query: async (_name: string, args: Record<string, unknown>) => {
      if (args.steamId === steamId) {
        return {
          ok: true,
          version: sessionVersion,
          lbVersion: sessionVersion,
          playerVersion: 1,
        };
      }
      throw new Error('unexpected query');
    },
    mutation: async () => {
      throw new Error('unexpected mutation');
    },
  });

  let statusCode = 0;
  let body: Record<string, unknown> | undefined;
  const req = {
    query: { steamId },
  } as unknown as Request;
  const res = {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload as Record<string, unknown>;
    },
  } as unknown as Response;

  try {
    await handleHudSnapshot(req, res);
    assert.equal(statusCode, 0);
    assert.equal(body?.ok, true);
    assert.equal(await hudRedisGet(sseKey), '1');
  } finally {
    resetConvexClientForTests();
    resetBattleSsePresenceForTests();
    resetManagedServersForTests();
    await hudRedisDel(sessionKey);
    await clearHudSsePresence(steamId);
  }
});
