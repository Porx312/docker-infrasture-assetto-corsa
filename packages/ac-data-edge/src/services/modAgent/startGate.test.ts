import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isUnrecoverableModBlocker,
  localContentExists,
  requiredSlugsFromConfig,
  unresolvedModItems,
  _resetEnsureInFlightForTests,
} from './startGate.js';

test('requiredSlugsFromConfig parses track and cars', () => {
  assert.deepEqual(requiredSlugsFromConfig({ track: 't1', cars: 'a;b,c' }), ['t1', 'a', 'b', 'c']);
  assert.deepEqual(requiredSlugsFromConfig({}), []);
});

test('isUnrecoverableModBlocker catches UNKNOWN_PACKAGE and catalog errors', () => {
  const blockers = isUnrecoverableModBlocker(
    [
      { acContentSlug: 'pk_akina', status: 'UNKNOWN_PACKAGE' },
      { acContentSlug: 'other', status: 'PENDING' },
    ],
    [{ acContentSlug: 'other', artifactId: null, message: 'no_catalog_artifact: status=UNKNOWN_PACKAGE' }],
  );
  assert.equal(blockers.length, 2);
  assert.ok(blockers.some((b) => b.acContentSlug === 'pk_akina'));
  assert.ok(blockers.some((b) => b.acContentSlug === 'other'));
});

test('unresolvedModItems: local cache allows start without hub READY', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sg-'));
  process.env.CONTENT_PATH = root;
  await fsp.mkdir(path.join(root, 'cars', 'my_car'), { recursive: true });
  const unresolved = unresolvedModItems([
    { acContentSlug: 'my_car', status: 'NOT_INSTALLED' },
    { acContentSlug: 'missing_car', status: 'NOT_INSTALLED' },
  ]);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].acContentSlug, 'missing_car');
  await fsp.rm(root, { recursive: true, force: true });
});

test('unresolvedModItems: hub READY without local folder is NOT ready (no false success)', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sg-'));
  process.env.CONTENT_PATH = root;
  await fsp.mkdir(path.join(root, 'cars'), { recursive: true });
  const unresolved = unresolvedModItems([{ acContentSlug: 'ghost', status: 'READY' }]);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].acContentSlug, 'ghost');
  await fsp.rm(root, { recursive: true, force: true });
});

test('unresolvedModItems: queued/syncing never count as installed without disk', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sg-'));
  process.env.CONTENT_PATH = root;
  await fsp.mkdir(path.join(root, 'tracks'), { recursive: true });
  const unresolved = unresolvedModItems([
    { acContentSlug: 'trk', status: 'SYNCING' },
    { acContentSlug: 'trk2', status: 'PENDING' },
  ]);
  assert.equal(unresolved.length, 2);
  await fsp.rm(root, { recursive: true, force: true });
});

test('unresolvedModItems: hub READY + local folder is ready', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sg-'));
  process.env.CONTENT_PATH = root;
  await fsp.mkdir(path.join(root, 'tracks', 'trk'), { recursive: true });
  const unresolved = unresolvedModItems([{ acContentSlug: 'trk', status: 'READY' }]);
  assert.equal(unresolved.length, 0);
  assert.equal(localContentExists('trk'), true);
  await fsp.rm(root, { recursive: true, force: true });
});

test('concurrent ensure map resets', () => {
  _resetEnsureInFlightForTests();
});
