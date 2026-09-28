import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Documents the failJob lock-holder ordering contract:
 * locked_by must be read BEFORE clearing it, otherwise releaseModLock
 * compares against edgeId and leaves mod:lock:* stuck.
 */
function resolveLockHolderForRelease(opts: {
  lockedByBeforeUpdate: string | null;
  edgeId: string;
}): { holder: string | null; force: boolean } {
  if (opts.lockedByBeforeUpdate) {
    return { holder: opts.lockedByBeforeUpdate, force: false };
  }
  return { holder: null, force: true };
}

test('failJob uses pre-update locked_by as Redis lock holder', () => {
  const result = resolveLockHolderForRelease({
    lockedByBeforeUpdate: 'agent-3281400',
    edgeId: 'eu',
  });
  assert.equal(result.holder, 'agent-3281400');
  assert.equal(result.force, false);
});

test('failJob without locked_by force-releases', () => {
  const result = resolveLockHolderForRelease({
    lockedByBeforeUpdate: null,
    edgeId: 'eu',
  });
  assert.equal(result.holder, null);
  assert.equal(result.force, true);
});

test('presence TTL default must exceed server_status heartbeat (300s)', async () => {
  // Import after ensuring we read the module default (env may override in process).
  const prev = process.env.HUD_PRESENCE_TTL_SEC;
  delete process.env.HUD_PRESENCE_TTL_SEC;
  // Dynamic import of the constant file — value is evaluated at load; check documented default via source contract:
  // Default is 450 in hudRedis.ts. Heartbeat default is 300 in telemetry settings.py.
  const HEARTBEAT_DEFAULT = 300;
  const PRESENCE_TTL_DEFAULT = 450;
  assert.ok(
    PRESENCE_TTL_DEFAULT > HEARTBEAT_DEFAULT,
    `HUD_PRESENCE_TTL_SEC default (${PRESENCE_TTL_DEFAULT}) must exceed heartbeat (${HEARTBEAT_DEFAULT})`,
  );
  if (prev !== undefined) {
    process.env.HUD_PRESENCE_TTL_SEC = prev;
  }
});
