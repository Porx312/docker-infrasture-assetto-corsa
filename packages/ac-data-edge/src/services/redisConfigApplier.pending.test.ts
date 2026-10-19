import assert from 'node:assert/strict';
import test from 'node:test';
import {
  _pendingReconcileCountForTests,
  _resetPendingReconcileForTests,
  contentOverridesFromRow,
  notifyContentReadyForConfigApplier,
  shouldApplyConfigSnapshot,
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

test('shouldApplyConfigSnapshot rejects missing instanceId (fail-closed)', () => {
  const gate = shouldApplyConfigSnapshot(
    { event: 'server_config_snapshot', data: { servers: [] } },
    'vps-eu-2',
  );
  assert.equal(gate.apply, false);
  assert.equal(gate.reason, 'missing_instance_id');
});

test('shouldApplyConfigSnapshot rejects foreign instanceId', () => {
  const gate = shouldApplyConfigSnapshot(
    {
      event: 'server_config_snapshot',
      instanceId: 'vps-us-1',
      data: { instanceId: 'vps-us-1', servers: [] },
    },
    'vps-eu-2',
  );
  assert.equal(gate.apply, false);
  assert.equal(gate.reason, 'foreign_instance_id');
});

test('shouldApplyConfigSnapshot accepts matching instanceId', () => {
  const gate = shouldApplyConfigSnapshot(
    {
      event: 'server_config_snapshot',
      data: { instanceId: 'vps-eu-2', servers: [{ serverName: 'server-1' }] },
    },
    'vps-eu-2',
  );
  assert.equal(gate.apply, true);
});
