import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLiveServerRef } from './liveRoster.js';
import {
  presenceRosterRedisKey,
  parsePresenceRosterKeySuffix,
} from '@projectd/ac-data-shared/services/hud/hudCacheKeys.js';

test('parseLiveServerRef keeps plain lobby names', () => {
  assert.deepEqual(parseLiveServerRef('ProjectD'), {
    serverId: 'ProjectD',
    instanceId: null,
  });
});

test('parseLiveServerRef splits instanceId:lobby composites', () => {
  assert.deepEqual(parseLiveServerRef('vps-eu-2:ProjectD'), {
    serverId: 'ProjectD',
    instanceId: 'vps-eu-2',
  });
});

test('scoped roster key format matches writers', () => {
  assert.equal(
    presenceRosterRedisKey('projectd', 'vps-eu-2'),
    'ac:hud:presence:roster:vps-eu-2:projectd',
  );
  assert.deepEqual(parsePresenceRosterKeySuffix('vps-eu-2:projectd'), {
    instanceId: 'vps-eu-2',
    serverId: 'projectd',
  });
});
