import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVE_INGEST_CONVEX,
  shouldSkipLivePresenceConvexIngest,
} from './ingestPrefPartition.js';

test('shouldSkipLivePresenceConvexIngest skips join/leave/status when flag false', () => {
  assert.equal(shouldSkipLivePresenceConvexIngest('player_join', false), true);
  assert.equal(shouldSkipLivePresenceConvexIngest('player_leave', false), true);
  assert.equal(shouldSkipLivePresenceConvexIngest('server_status', false), true);
  assert.equal(shouldSkipLivePresenceConvexIngest('lap_completed', false), false);
});

test('shouldSkipLivePresenceConvexIngest forwards when flag true', () => {
  assert.equal(shouldSkipLivePresenceConvexIngest('player_join', true), false);
  assert.equal(shouldSkipLivePresenceConvexIngest('server_status', true), false);
});

test('LIVE_INGEST_CONVEX is a boolean (default false — fleet cutover)', () => {
  assert.equal(typeof LIVE_INGEST_CONVEX, 'boolean');
});
