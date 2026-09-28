import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resetFleetRegistryForTests,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { inventoryInstanceIdCandidates } from './modsInventory.js';

test('inventoryInstanceIdCandidates includes fleet id and AC_INSTANCE_ID aliases', () => {
  resetFleetRegistryForTests();
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: {
      label: 'Game VPS',
      baseUrl: 'http://13.140.160.131:3000',
      instanceId: 'vps-eu-2',
    },
  });
  resetFleetRegistryForTests();

  assert.deepEqual(inventoryInstanceIdCandidates('vps-eu-2').sort(), ['eu', 'vps-eu-2'].sort());
  assert.deepEqual(inventoryInstanceIdCandidates('eu').sort(), ['eu', 'vps-eu-2'].sort());
  assert.deepEqual(inventoryInstanceIdCandidates('unknown'), ['unknown']);

  delete process.env.FLEET_EDGE_REGISTRY;
  resetFleetRegistryForTests();
});
