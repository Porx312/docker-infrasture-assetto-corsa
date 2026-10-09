import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveInstanceId } from './hudPlayerPresence.js';

/**
 * Integration contract: presence writers must prefer payload.instanceId over
 * consumer AC_INSTANCE_ID so shared Redis consumer group cannot mis-route HUD.
 */
test('resolveInstanceId prefers payload over AC_INSTANCE_ID', () => {
  const prev = process.env.AC_INSTANCE_ID;
  process.env.AC_INSTANCE_ID = 'vps-eu-2';
  assert.equal(
    resolveInstanceId({
      instanceId: 'vps-us-1',
      data: { trackName: 'ks_nord' },
    }),
    'vps-us-1',
  );
  if (prev !== undefined) process.env.AC_INSTANCE_ID = prev;
  else delete process.env.AC_INSTANCE_ID;
});

test('resolveInstanceId falls back to AC_INSTANCE_ID when payload omits it', () => {
  const prev = process.env.AC_INSTANCE_ID;
  process.env.AC_INSTANCE_ID = 'vps-eu-2';
  assert.equal(resolveInstanceId({ data: {} }), 'vps-eu-2');
  if (prev !== undefined) process.env.AC_INSTANCE_ID = prev;
  else delete process.env.AC_INSTANCE_ID;
});
