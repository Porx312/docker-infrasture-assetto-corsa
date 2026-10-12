import assert from 'node:assert/strict';
import test from 'node:test';

import { setFetchPlayerJoinContextForTests } from './playerJoinContext.js';
import { refreshHudUserStatusFromConvex } from './hudUserStatusNotify.js';

test('refreshHudUserStatusFromConvex propagates Convex fetch failure', async () => {
  const prevSecret = process.env.CONVEX_WORKER_SECRET;
  const prevUrl = process.env.CONVEX_DEPLOYMENT_URL;
  const prevKey = process.env.CONVEX_PRODUCT_KEY;
  process.env.CONVEX_WORKER_SECRET = 'test-secret';
  process.env.CONVEX_DEPLOYMENT_URL = 'https://example.convex.cloud';
  process.env.CONVEX_PRODUCT_KEY = 'test-product-key';

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
    if (prevSecret === undefined) delete process.env.CONVEX_WORKER_SECRET;
    else process.env.CONVEX_WORKER_SECRET = prevSecret;
    if (prevUrl === undefined) delete process.env.CONVEX_DEPLOYMENT_URL;
    else process.env.CONVEX_DEPLOYMENT_URL = prevUrl;
    if (prevKey === undefined) delete process.env.CONVEX_PRODUCT_KEY;
    else process.env.CONVEX_PRODUCT_KEY = prevKey;
  }
});
