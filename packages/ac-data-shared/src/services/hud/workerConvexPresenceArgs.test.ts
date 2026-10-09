import assert from 'node:assert/strict';
import test from 'node:test';

import { hudWorkerPresenceFromRecord } from './hudWorkerPresence.js';

/**
 * Contract: both hub-forward (edgeHubWorkerClient) and direct Convex paths
 * must pass the same `presence` object shape when Redis presence exists.
 */
test('presence args include fleet routing fields for Convex cutover', () => {
  const presence = hudWorkerPresenceFromRecord({
    serverName: 'Battles P',
    instanceId: 'vps-us-1',
    folderSlug: 'server-2',
    carModel: 'ks_toyota_ae86',
    track: 'ks_highlands',
    trackConfig: 'layout_a',
  });
  assert.ok(presence);
  assert.equal(presence?.serverName, 'Battles P');
  assert.equal(presence?.instanceId, 'vps-us-1');
  assert.equal(presence?.folderSlug, 'server-2');
  assert.equal(presence?.trackConfig, 'layout_a');
  // Empty trackConfig is omitted (optional) — non-empty fields always present for cutover.
  assert.ok(presence?.carModel && presence?.track);
});
