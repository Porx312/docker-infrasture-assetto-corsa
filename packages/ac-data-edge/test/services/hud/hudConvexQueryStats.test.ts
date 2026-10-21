import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHudConvexQueryStats,
  recordHudConvexQuery,
  resetHudConvexQueryStatsForTests,
} from '../../../src/services/hud/hudConvexQueryStats.js';
import { resetHudPushConnectionsForTests } from '../../../src/services/hud/hudPushHub.js';

test('recordHudConvexQuery increments per label', () => {
  resetHudConvexQueryStatsForTests();
  resetHudPushConnectionsForTests();

  recordHudConvexQuery('fetchHudSession');
  recordHudConvexQuery('fetchHudSession');
  recordHudConvexQuery('fetchHudVersion');

  const stats = getHudConvexQueryStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.queries.fetchHudSession, 2);
  assert.equal(stats.queries.fetchHudVersion, 1);
  assert.equal(stats.streamConnected, 0);
});
