import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resetConvexClientForTests,
  setConvexClientForTests,
} from '../convexClient.js';
import {
  fetchHudSession,
  fetchHudVersion,
  fetchPlayerJoinContext,
  fetchWorkerSyncVersion,
} from './hudConvex.js';
import { resetHudConvexQueryStatsForTests } from './hudConvexQueryStats.js';

function fetchFailedError(): TypeError {
  return new TypeError('fetch failed', { cause: new Error('read ECONNRESET') });
}

function mockClientThrowing(): void {
  setConvexClientForTests({
    query: async () => {
      throw fetchFailedError();
    },
    mutation: async () => {
      throw fetchFailedError();
    },
  });
}

test('fetchHudVersion returns convex_unreachable on fetch failed', async () => {
  resetHudConvexQueryStatsForTests();
  mockClientThrowing();
  try {
    const result = await fetchHudVersion({ steamId: '76561199000000001', now: Date.now() });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'convex_unreachable');
    }
  } finally {
    resetConvexClientForTests();
  }
});

test('fetchHudSession returns convex_unreachable on fetch failed', async () => {
  mockClientThrowing();
  try {
    const result = await fetchHudSession({ steamId: '76561199000000001' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'convex_unreachable');
    }
  } finally {
    resetConvexClientForTests();
  }
});

test('fetchPlayerJoinContext returns convex_unreachable on fetch failed', async () => {
  mockClientThrowing();
  try {
    const result = await fetchPlayerJoinContext('76561199000000001');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'convex_unreachable');
    }
  } finally {
    resetConvexClientForTests();
  }
});

test('fetchWorkerSyncVersion returns defaults on fetch failed', async () => {
  mockClientThrowing();
  try {
    const result = await fetchWorkerSyncVersion();
    assert.deepEqual(result, {
      configVersion: '',
      pollIntervalMs: 30_000,
      pollJitterMs: 0,
    });
  } finally {
    resetConvexClientForTests();
  }
});
