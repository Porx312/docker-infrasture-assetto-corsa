import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearUserInvalidated,
  markUserInvalidated,
  readUserInvalidated,
  userInvalidatedRedisKey,
  USER_INVALIDATED_CHANNEL,
  USER_INVALIDATED_TTL_SEC,
} from './hudUserInvalidation.js';
import { hudRedisDel, isHudRedisConfigured } from './hudRedis.js';

const steamId = '76561199000000999';

test('userInvalidatedRedisKey uses steamId suffix', () => {
  assert.equal(userInvalidatedRedisKey('76561199000000001'), 'ac:user:invalidated:76561199000000001');
});

test('markUserInvalidated sets key and clearUserInvalidated removes it', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const key = userInvalidatedRedisKey(steamId);
  await hudRedisDel(key);

  assert.equal(await readUserInvalidated(steamId), false);
  await markUserInvalidated(steamId);
  assert.equal(await readUserInvalidated(steamId), true);
  await clearUserInvalidated(steamId);
  assert.equal(await readUserInvalidated(steamId), false);
});

test('markUserInvalidated ignores unknown_ steam ids', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const unknownId = 'unknown_abc';
  const key = userInvalidatedRedisKey(unknownId);
  await hudRedisDel(key);
  await markUserInvalidated(unknownId);
  assert.equal(await readUserInvalidated(unknownId), false);
});

test('USER_INVALIDATED_TTL_SEC defaults to one day', () => {
  assert.equal(USER_INVALIDATED_TTL_SEC, 86_400);
});

test('USER_INVALIDATED_CHANNEL default', () => {
  assert.equal(USER_INVALIDATED_CHANNEL, 'ac:user:invalidated');
});
