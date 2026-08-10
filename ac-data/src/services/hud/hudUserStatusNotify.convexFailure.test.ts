import assert from 'node:assert/strict';
import test from 'node:test';

import { setFetchPlayerJoinContextForTests } from './playerJoinContext.js';
import { refreshHudUserStatusFromConvex } from './hudUserStatusNotify.js';

test('refreshHudUserStatusFromConvex propagates Convex fetch failure', async () => {
  process.env.CONVEX_WORKER_SECRET = process.env.CONVEX_WORKER_SECRET || 'test-secret';

  setFetchPlayerJoinContextForTests(async () => {
    throw new Error('convex unreachable');
  });

  try {
    await assert.rejects(
      () => refreshHudUserStatusFromConvex('76561199000000001'),
      /convex unreachable/,
    );
  } finally {
    setFetchPlayerJoinContextForTests(null);
  }
});
