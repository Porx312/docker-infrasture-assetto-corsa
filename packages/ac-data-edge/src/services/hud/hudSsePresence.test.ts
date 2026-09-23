import assert from 'node:assert/strict';
import test from 'node:test';

import { ssePresenceRedisKey } from './hudCacheKeys.js';
import { hudRedisDel, hudRedisGet, isHudRedisConfigured } from './hudRedis.js';
import {
  clearHudSsePresence,
  markHudSseConnected,
  renewHudSsePresence,
} from './hudSsePresence.js';

const steamId = '76561199000000888';

test('ssePresenceRedisKey uses steamId suffix', () => {
  assert.equal(ssePresenceRedisKey('76561199000000001'), 'ac:hud:sse:76561199000000001');
});

test('markHudSseConnected sets key and clearHudSsePresence removes it', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const key = ssePresenceRedisKey(steamId);
  await hudRedisDel(key);

  assert.equal(await hudRedisGet(key), null);
  await markHudSseConnected(steamId);
  assert.equal(await hudRedisGet(key), '1');
  await clearHudSsePresence(steamId);
  assert.equal(await hudRedisGet(key), null);
});

test('renewHudSsePresence extends TTL on existing key', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const key = ssePresenceRedisKey(steamId);
  await hudRedisDel(key);
  await markHudSseConnected(steamId);
  await renewHudSsePresence(steamId);
  assert.equal(await hudRedisGet(key), '1');
  await clearHudSsePresence(steamId);
});

test('markHudSseConnected ignores empty steamId', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await markHudSseConnected('   ');
  assert.equal(await hudRedisGet(ssePresenceRedisKey('   ')), null);
});
