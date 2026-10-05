import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  matchFleetServerRow,
  resetJoinEndpointCacheForTests,
} from './joinEndpoint.js';
import type { FleetServerRow } from '../fleet/fleetServersMerge.js';
import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';

afterEach(() => {
  delete process.env.FLEET_EDGE_REGISTRY;
  resetFleetRegistryForTests();
  resetJoinEndpointCacheForTests();
});

const rows: FleetServerRow[] = [
  {
    fleetEdgeId: 'eu',
    fleetLabel: 'EU',
    instanceId: 'vps-eu-2',
    name: 'server-4',
    displayName: 'Battles P',
    wrapperPort: 18086,
    httpPort: 8086,
    joinIp: '13.140.160.131',
    joinUrl: 'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8086',
  },
  {
    fleetEdgeId: 'eu',
    fleetLabel: 'EU',
    instanceId: 'vps-eu-2',
    name: 'server-1',
    displayName: 'ProjectD',
    wrapperPort: 18081,
    httpPort: 8081,
    joinIp: '13.140.160.131',
    joinUrl: 'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8081',
  },
];

test('matchFleetServerRow prefers folderSlug', () => {
  const row = matchFleetServerRow(rows, {
    instanceId: 'vps-eu-2',
    lobbyName: 'Battles P',
    folderSlug: 'server-4',
  });
  assert.equal(row?.httpPort, 8086);
  assert.equal(row?.name, 'server-4');
});

test('matchFleetServerRow falls back to lobby displayName', () => {
  const row = matchFleetServerRow(rows, {
    instanceId: 'vps-eu-2',
    lobbyName: 'Battles P',
  });
  assert.equal(row?.name, 'server-4');
  assert.equal(row?.httpPort, 8086);
});

test('matchFleetServerRow strips CM suffix on displayName', () => {
  const withSuffix: FleetServerRow[] = [
    {
      ...rows[0]!,
      displayName: 'Battles P \u213918086',
    },
  ];
  const row = matchFleetServerRow(withSuffix, {
    instanceId: 'vps-eu-2',
    lobbyName: 'Battles P',
  });
  assert.equal(row?.httpPort, 8086);
});
