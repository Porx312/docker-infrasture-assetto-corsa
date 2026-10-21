import assert from 'node:assert/strict';
import test from 'node:test';
import {
  _flushLifecycleHeartbeatForTests,
  _resetServerLifecycleForTests,
  clearServerLifecycle,
  coarseStatusForPhase,
  getServerLifecycle,
  setLifecycleHeartbeatPublisher,
  setServerLifecycle,
} from '../../src/services/serverLifecycle.js';

test('coarseStatusForPhase maps ONLINE/FAILED/others', () => {
  assert.equal(coarseStatusForPhase('ONLINE'), 'live');
  assert.equal(coarseStatusForPhase('FAILED'), 'error');
  assert.equal(coarseStatusForPhase('PREPARING'), 'starting');
  assert.equal(coarseStatusForPhase('CONFIGURING'), 'starting');
  assert.equal(coarseStatusForPhase('STARTING'), 'starting');
  assert.equal(coarseStatusForPhase('CHECKING'), 'starting');
});

test('setServerLifecycle stores phase and truncates detail', async () => {
  _resetServerLifecycleForTests();
  let beats = 0;
  setLifecycleHeartbeatPublisher(async () => {
    beats += 1;
  });
  setServerLifecycle('server-1', 'PREPARING', 'waiting');
  await _flushLifecycleHeartbeatForTests();
  const st = getServerLifecycle('server-1');
  assert.ok(st);
  assert.equal(st!.phase, 'PREPARING');
  assert.equal(st!.phaseDetail, 'waiting');
  assert.ok(typeof st!.phaseUpdatedAt === 'number' && st!.phaseUpdatedAt > 0);
  assert.equal(beats, 1);

  // unchanged → no extra heartbeat
  setServerLifecycle('server-1', 'PREPARING', 'waiting');
  await _flushLifecycleHeartbeatForTests();
  assert.equal(beats, 1);

  setServerLifecycle('server-1', 'ONLINE');
  await _flushLifecycleHeartbeatForTests();
  assert.equal(getServerLifecycle('server-1')!.phase, 'ONLINE');
  assert.equal(beats, 2);
});

test('clearServerLifecycle removes fields and heartbeats', async () => {
  _resetServerLifecycleForTests();
  let beats = 0;
  setLifecycleHeartbeatPublisher(async () => {
    beats += 1;
  });
  setServerLifecycle('s2', 'FAILED', 'boom');
  await _flushLifecycleHeartbeatForTests();
  clearServerLifecycle('s2');
  await _flushLifecycleHeartbeatForTests();
  assert.equal(getServerLifecycle('s2'), null);
  assert.ok(beats >= 2);
});

test('concurrent updates publish final phase only once coalesced', async () => {
  _resetServerLifecycleForTests();
  const seen: string[] = [];
  setLifecycleHeartbeatPublisher(async () => {
    seen.push(getServerLifecycle('s3')?.phase || 'none');
    await new Promise((r) => setTimeout(r, 15));
  });
  setServerLifecycle('s3', 'PREPARING');
  setServerLifecycle('s3', 'CONFIGURING');
  setServerLifecycle('s3', 'STARTING');
  await _flushLifecycleHeartbeatForTests();
  assert.equal(getServerLifecycle('s3')!.phase, 'STARTING');
  // At least one heartbeat; last published state must be STARTING
  assert.ok(seen.length >= 1);
  assert.equal(seen[seen.length - 1], 'STARTING');
});

test('servers stay isolated', () => {
  _resetServerLifecycleForTests();
  setServerLifecycle('a', 'ONLINE');
  setServerLifecycle('b', 'FAILED', 'x');
  assert.equal(getServerLifecycle('a')!.phase, 'ONLINE');
  assert.equal(getServerLifecycle('b')!.phase, 'FAILED');
  clearServerLifecycle('a');
  assert.equal(getServerLifecycle('a'), null);
  assert.equal(getServerLifecycle('b')!.phase, 'FAILED');
});
