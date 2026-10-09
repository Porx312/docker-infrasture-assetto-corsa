import assert from 'node:assert/strict';
import test from 'node:test';

import { connPresenceRedisKey, ssePresenceRedisKey } from './hudCacheKeys.js';
import { hudRedisDel, hudRedisGet, isHudRedisConfigured } from './hudRedis.js';
import {
  clearHudConnPresence,
  markHudConnConnected,
  renewHudConnPresence,
} from './hudConnPresence.js';

const steamId = '76561199000000888';

test('connPresenceRedisKey uses steamId suffix', () => {
  assert.equal(connPresenceRedisKey('76561199000000001'), 'ac:hud:conn:76561199000000001');
});

test('markHudConnConnected dual-writes conn + legacy sse keys', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const connKey = connPresenceRedisKey(steamId);
  const sseKey = ssePresenceRedisKey(steamId);
  await hudRedisDel(connKey);
  await hudRedisDel(sseKey);

  assert.equal(await hudRedisGet(connKey), null);
  await markHudConnConnected(steamId);
  assert.equal(await hudRedisGet(connKey), '1');
  assert.equal(await hudRedisGet(sseKey), '1');
  await clearHudConnPresence(steamId);
  assert.equal(await hudRedisGet(connKey), null);
  assert.equal(await hudRedisGet(sseKey), null);
});

test('renewHudConnPresence extends TTL on existing key', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const key = connPresenceRedisKey(steamId);
  await hudRedisDel(key);
  await markHudConnConnected(steamId);
  await renewHudConnPresence(steamId);
  assert.equal(await hudRedisGet(key), '1');
  await clearHudConnPresence(steamId);
});

test('markHudConnConnected ignores empty steamId', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await markHudConnConnected('   ');
  assert.equal(await hudRedisGet(connPresenceRedisKey('   ')), null);
});
