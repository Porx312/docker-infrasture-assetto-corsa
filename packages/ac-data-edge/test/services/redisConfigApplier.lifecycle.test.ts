import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { activeServers } from '../../src/controller/controller.js';
import {
  _preflightModsForRowForTests,
  _reconcileServerForTests,
  _resetLastSignaturesForTests,
  _resetPendingReconcileForTests,
  _seedLastSignatureForTests,
} from '../../src/services/redisConfigApplier.js';
import {
  _resetServerLifecycleForTests,
  getServerLifecycle,
  setServerLifecycle,
} from '../../src/services/serverLifecycle.js';

function makeServerFixture(tmp: string, name: string): void {
  fs.mkdirSync(path.join(tmp, name, 'cfg'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, name, 'cfg', 'server_cfg.ini'),
    '[SERVER]\nNAME=lobby\nTRACK=ks_nordschleife\nCONFIG_TRACK=\nCARS=\nHTTP_PORT=8081\nUDP_PORT=9600\nTCP_PORT=9600\n',
    'utf-8',
  );
}

test('unchanged-signature reconcile recovers ONLINE while process is up', async () => {
  _resetServerLifecycleForTests();
  _resetPendingReconcileForTests();
  _resetLastSignaturesForTests();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-applier-sig-'));
  const prevServers = process.env.SERVERS_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;

  try {
    makeServerFixture(tmp, name);
    activeServers[name] = { pid: 5555, process: {} as never };

    const row = {
      serverName: name,
      isActive: true,
      track: '',
      entries: [] as { model: string }[],
    };
    _seedLastSignatureForTests(row);
    setServerLifecycle(name, 'PREPARING', 'preflight mods');

    const outcome = await _reconcileServerForTests(row, false);
    assert.equal(outcome, 'applied');
    assert.equal(getServerLifecycle(name)?.phase, 'ONLINE');
  } finally {
    delete activeServers[name];
    if (prevServers !== undefined) process.env.SERVERS_PATH = prevServers;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
    _resetServerLifecycleForTests();
    _resetPendingReconcileForTests();
    _resetLastSignaturesForTests();
  }
});

test('already-running apply path ends ONLINE', async () => {
  _resetServerLifecycleForTests();
  _resetPendingReconcileForTests();
  _resetLastSignaturesForTests();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-applier-run-'));
  const prevServers = process.env.SERVERS_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;

  try {
    makeServerFixture(tmp, name);
    activeServers[name] = { pid: 6666, process: {} as never };

    const row = {
      serverName: name,
      isActive: true,
      track: '',
      entries: [] as { model: string }[],
    };
    // Same signature + first snapshot skips early-return but hits "already running".
    _seedLastSignatureForTests(row);
    setServerLifecycle(name, 'CONFIGURING', 'applying server_cfg / branding');

    const outcome = await _reconcileServerForTests(row, true);
    assert.equal(outcome, 'applied');
    assert.equal(getServerLifecycle(name)?.phase, 'ONLINE');
  } finally {
    delete activeServers[name];
    if (prevServers !== undefined) process.env.SERVERS_PATH = prevServers;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
    _resetServerLifecycleForTests();
    _resetPendingReconcileForTests();
    _resetLastSignaturesForTests();
  }
});

test('preflight fast path with local content does not set PREPARING', async () => {
  _resetServerLifecycleForTests();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-applier-pre-'));
  const content = path.join(tmp, 'content');
  const prevServers = process.env.SERVERS_PATH;
  const prevContent = process.env.CONTENT_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;
  process.env.CONTENT_PATH = content;

  try {
    makeServerFixture(tmp, name);
    fs.mkdirSync(path.join(content, 'tracks', 'pk_akina'), { recursive: true });
    fs.mkdirSync(path.join(content, 'cars', 'car_a'), { recursive: true });
    // Usable car marker for getAvailableCars / isCarFolderAvailable if entries present
    fs.mkdirSync(path.join(content, 'cars', 'car_a', 'skins', 'default'), { recursive: true });
    fs.writeFileSync(path.join(content, 'cars', 'car_a', 'data.acd'), 'x');

    setServerLifecycle(name, 'ONLINE', 'httpPort=8081');

    const result = await _preflightModsForRowForTests({
      serverName: name,
      isActive: true,
      track: 'pk_akina',
      entries: [{ model: 'car_a' }],
    });
    assert.equal(result, 'ok');
    assert.equal(getServerLifecycle(name)?.phase, 'ONLINE');
  } finally {
    if (prevServers !== undefined) process.env.SERVERS_PATH = prevServers;
    else delete process.env.SERVERS_PATH;
    if (prevContent !== undefined) process.env.CONTENT_PATH = prevContent;
    else delete process.env.CONTENT_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
    _resetServerLifecycleForTests();
  }
});
