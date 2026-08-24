import assert from 'node:assert/strict';
import test from 'node:test';

import { isHudRedisConfigured } from './hudRedis.js';
import {
  setClearUserInvalidatedForTests,
  setMarkUserInvalidatedForTests,
} from './hudUserInvalidation.js';
import {
  setMarkUserNotRegisteredForTests,
} from './hudUserNotRegistered.js';
import { applyPlayerJoinContext } from './playerJoinContext.js';

const steamId = '76561199000000666';

test('applyPlayerJoinContext defaults publishEnforcement to false', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const invalidatedCalls: Array<{ publish?: boolean }> = [];
  const notRegisteredCalls: Array<{ publish?: boolean }> = [];

  setMarkUserInvalidatedForTests(async (_id, options) => {
    invalidatedCalls.push(options ?? {});
  });
  setMarkUserNotRegisteredForTests(async (_id, options) => {
    notRegisteredCalls.push(options ?? {});
  });

  try {
    await applyPlayerJoinContext(steamId, {
      ok: false,
      reason: 'user_invalidated',
      user: { steamId, isInvalidated: true },
    });

    assert.equal(invalidatedCalls.length, 1);
    assert.equal(invalidatedCalls[0]?.publish, false);

    invalidatedCalls.length = 0;

    await applyPlayerJoinContext(steamId, {
      ok: false,
      reason: 'user_not_found',
    });

    assert.equal(notRegisteredCalls.length, 1);
    assert.equal(notRegisteredCalls[0]?.publish, false);
  } finally {
    setMarkUserInvalidatedForTests(null);
    setMarkUserNotRegisteredForTests(null);
  }
});

test('applyPlayerJoinContext publishEnforcement true passes publish to mark helpers', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const invalidatedCalls: Array<{ publish?: boolean }> = [];
  const notRegisteredCalls: Array<{ publish?: boolean }> = [];

  setMarkUserInvalidatedForTests(async (_id, options) => {
    invalidatedCalls.push(options ?? {});
  });
  setMarkUserNotRegisteredForTests(async (_id, options) => {
    notRegisteredCalls.push(options ?? {});
  });

  try {
    await applyPlayerJoinContext(
      steamId,
      {
        ok: false,
        reason: 'user_invalidated',
        user: { steamId, isInvalidated: true },
      },
      { publishEnforcement: true },
    );

    assert.equal(invalidatedCalls.length, 1);
    assert.equal(invalidatedCalls[0]?.publish, true);

    invalidatedCalls.length = 0;
    notRegisteredCalls.length = 0;

    await applyPlayerJoinContext(
      steamId,
      { ok: false, reason: 'user_not_found' },
      { publishEnforcement: true },
    );

    assert.equal(notRegisteredCalls.length, 1);
    assert.equal(notRegisteredCalls[0]?.publish, true);
  } finally {
    setMarkUserInvalidatedForTests(null);
    setMarkUserNotRegisteredForTests(null);
  }
});

test('applyPlayerJoinContext user_not_found does not clear ban key', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const clearCalls: string[] = [];
  const notRegisteredCalls: Array<{ publish?: boolean }> = [];

  setClearUserInvalidatedForTests(async (id) => {
    clearCalls.push(id);
  });
  setMarkUserNotRegisteredForTests(async (_id, options) => {
    notRegisteredCalls.push(options ?? {});
  });

  try {
    await applyPlayerJoinContext(steamId, {
      ok: false,
      reason: 'user_not_found',
    });

    assert.equal(notRegisteredCalls.length, 1);
    assert.equal(clearCalls.length, 0);
  } finally {
    setClearUserInvalidatedForTests(null);
    setMarkUserNotRegisteredForTests(null);
  }
});
