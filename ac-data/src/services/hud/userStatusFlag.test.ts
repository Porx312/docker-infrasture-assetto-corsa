import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markUserStatusFlag,
  readUserStatusFlag,
  userStatusFlagRedisKey,
} from './userStatusFlag.js';
import { hudRedisDel, isHudRedisConfigured } from './hudRedis.js';

const steamId = '76561199000000998';
const prefix = 'ac:test:flag:';

test('markUserStatusFlag sets redis key without requiring publish opt-in', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const key = userStatusFlagRedisKey(prefix, steamId);
  await hudRedisDel(key);

  await markUserStatusFlag(
    { redisPrefix: prefix, channel: 'ac:test:unused', ttlSec: 60, logLabel: 'test-flag' },
    steamId,
  );

  assert.equal(await readUserStatusFlag(prefix, steamId), true);
  await hudRedisDel(key);
});
