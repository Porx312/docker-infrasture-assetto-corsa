import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearUserNotRegistered,
  markUserNotRegistered,
  readUserNotRegistered,
  userNotRegisteredRedisKey,
  USER_NOT_REGISTERED_CHANNEL,
  USER_NOT_REGISTERED_TTL_SEC,
} from './hudUserNotRegistered.js';
import { hudRedisDel, isHudRedisConfigured } from './hudRedis.js';

const steamId = '76561199000000998';

test('userNotRegisteredRedisKey uses steamId suffix', () => {
  assert.equal(
    userNotRegisteredRedisKey('76561199000000001'),
    'ac:user:not_registered:76561199000000001',
  );
});

test('markUserNotRegistered sets key and clearUserNotRegistered removes it', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const key = userNotRegisteredRedisKey(steamId);
  await hudRedisDel(key);

  assert.equal(await readUserNotRegistered(steamId), false);
  await markUserNotRegistered(steamId);
  assert.equal(await readUserNotRegistered(steamId), true);
  await clearUserNotRegistered(steamId);
  assert.equal(await readUserNotRegistered(steamId), false);
});

test('markUserNotRegistered ignores unknown_ steam ids', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const unknownId = 'unknown_abc';
  const key = userNotRegisteredRedisKey(unknownId);
  await hudRedisDel(key);
  await markUserNotRegistered(unknownId);
  assert.equal(await readUserNotRegistered(unknownId), false);
});

test('USER_NOT_REGISTERED_TTL_SEC defaults to one day', () => {
  assert.equal(USER_NOT_REGISTERED_TTL_SEC, 86_400);
});

test('USER_NOT_REGISTERED_CHANNEL default', () => {
  assert.equal(USER_NOT_REGISTERED_CHANNEL, 'ac:user:not_registered');
});
