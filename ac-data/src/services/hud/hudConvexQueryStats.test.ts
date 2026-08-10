import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHudConvexQueryStats,
  recordHudConvexQuery,
  resetHudConvexQueryStatsForTests,
} from './hudConvexQueryStats.js';
import { resetHudSseConnectionsForTests } from './hudSsePush.js';

test('recordHudConvexQuery increments per label', () => {
  resetHudConvexQueryStatsForTests();
  resetHudSseConnectionsForTests();

  recordHudConvexQuery('fetchHudSession');
  recordHudConvexQuery('fetchHudSession');
  recordHudConvexQuery('fetchHudVersion');

  const stats = getHudConvexQueryStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.queries.fetchHudSession, 2);
  assert.equal(stats.queries.fetchHudVersion, 1);
  assert.equal(stats.sseConnected, 0);
});
