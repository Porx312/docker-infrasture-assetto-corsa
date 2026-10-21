import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { activeServers } from '../../src/controller/controller.js';
import {
  _flushLifecycleHeartbeatForTests,
  _resetServerLifecycleForTests,
  clearServerLifecycle,
  coarseStatusForPhase,
  getServerLifecycle,
  markOnlineIfRunning,
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

test('markOnlineIfRunning sets ONLINE when process is up', () => {
  _resetServerLifecycleForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-life-online-'));
  const prevServers = process.env.SERVERS_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;
  try {
    fs.mkdirSync(path.join(tmp, name, 'cfg'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, name, 'cfg', 'server_cfg.ini'),
      '[SERVER]\nNAME=t\nHTTP_PORT=8081\nUDP_PORT=9600\nTCP_PORT=9600\n',
      'utf-8',
    );
    activeServers[name] = { pid: 4242, process: {} as never };
    setServerLifecycle(name, 'PREPARING', 'preflight mods');
    assert.equal(markOnlineIfRunning(name), true);
    const st = getServerLifecycle(name);
    assert.equal(st?.phase, 'ONLINE');
    assert.match(st?.phaseDetail || '', /httpPort=8081/);
  } finally {
    delete activeServers[name];
    if (prevServers !== undefined) process.env.SERVERS_PATH = prevServers;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
    _resetServerLifecycleForTests();
  }
});

test('markOnlineIfRunning returns false when not running', () => {
  _resetServerLifecycleForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-life-offline-'));
  const prevServers = process.env.SERVERS_PATH;
  const name = 'server-2';
  process.env.SERVERS_PATH = tmp;
  try {
    fs.mkdirSync(path.join(tmp, name, 'cfg'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, name, 'cfg', 'server_cfg.ini'),
      '[SERVER]\nNAME=t\nHTTP_PORT=8082\n',
      'utf-8',
    );
    delete activeServers[name];
    setServerLifecycle(name, 'PREPARING', 'waiting');
    assert.equal(markOnlineIfRunning(name), false);
    assert.equal(getServerLifecycle(name)?.phase, 'PREPARING');
  } finally {
    if (prevServers !== undefined) process.env.SERVERS_PATH = prevServers;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
    _resetServerLifecycleForTests();
  }
});
