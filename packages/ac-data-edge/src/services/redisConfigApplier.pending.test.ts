import assert from 'node:assert/strict';
import test from 'node:test';
import {
  _pendingReconcileCountForTests,
  _resetPendingReconcileForTests,
  contentOverridesFromRow,
  notifyContentReadyForConfigApplier,
} from './redisConfigApplier.js';

test('contentOverridesFromRow extracts track and cars', () => {
  const overrides = contentOverridesFromRow({
    serverName: 'server-9',
    track: 'csp/3465/../pk_akina',
    entries: [{ model: 'car_a' }, { model: 'car_b' }, { model: 'car_a' }],
  });
  assert.equal(overrides.track, 'pk_akina');
  assert.equal(overrides.cars, 'car_a;car_b');
});

test('notifyContentReadyForConfigApplier is safe with empty pending map', () => {
  _resetPendingReconcileForTests();
  assert.equal(_pendingReconcileCountForTests(), 0);
  notifyContentReadyForConfigApplier(['any_slug']);
  assert.equal(_pendingReconcileCountForTests(), 0);
});
