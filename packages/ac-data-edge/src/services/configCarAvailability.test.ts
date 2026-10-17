import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  filterValidEntries,
  getAvailableCars,
  isCarFolderAvailable,
  resolveCarsContentDir,
  resolveEntriesForApply,
  scanAvailableCars,
} from './configCarAvailability.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'car-avail-'));
}

test('resolveCarsContentDir prefers CONTENT_PATH over SERVERS_PATH', () => {
  assert.equal(
    resolveCarsContentDir({ CONTENT_PATH: '/pool', SERVERS_PATH: '/servers' }),
    path.join('/pool', 'cars'),
  );
  assert.equal(
    resolveCarsContentDir({ SERVERS_PATH: '/servers' }),
    path.join('/servers', 'content', 'cars'),
  );
  assert.equal(resolveCarsContentDir({}), null);
});

test('isCarFolderAvailable accepts kn5, data.acd, data/, skins/', () => {
  const root = mkTmp();
  try {
    const kn5 = path.join(root, 'car_kn5');
    fs.mkdirSync(kn5);
    fs.writeFileSync(path.join(kn5, 'car.kn5'), '');
    assert.equal(isCarFolderAvailable(kn5), true);

    const acd = path.join(root, 'car_acd');
    fs.mkdirSync(acd);
    fs.writeFileSync(path.join(acd, 'data.acd'), '');
    assert.equal(isCarFolderAvailable(acd), true);

    const dataDir = path.join(root, 'car_data');
    fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
    assert.equal(isCarFolderAvailable(dataDir), true);

    const skins = path.join(root, 'car_skins');
    fs.mkdirSync(path.join(skins, 'skins'), { recursive: true });
    assert.equal(isCarFolderAvailable(skins), true);

    const empty = path.join(root, 'car_empty');
    fs.mkdirSync(empty);
    assert.equal(isCarFolderAvailable(empty), false);

    assert.equal(isCarFolderAvailable(path.join(root, 'missing')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanAvailableCars lists only folders with install markers', () => {
  const cars = mkTmp();
  try {
    fs.mkdirSync(path.join(cars, 'good', 'data'), { recursive: true });
    fs.mkdirSync(path.join(cars, 'bad'), { recursive: true });
    const set = scanAvailableCars(cars);
    assert.ok(set.has('good'));
    assert.equal(set.has('bad'), false);
  } finally {
    fs.rmSync(cars, { recursive: true, force: true });
  }
});

test('getAvailableCars uses CONTENT_PATH', () => {
  const pool = mkTmp();
  try {
    fs.mkdirSync(path.join(pool, 'cars', 'rx7', 'skins'), { recursive: true });
    const set = getAvailableCars({ CONTENT_PATH: pool });
    assert.ok(set.has('rx7'));
  } finally {
    fs.rmSync(pool, { recursive: true, force: true });
  }
});

test('filterValidEntries returns valid + missing', () => {
  const available = new Set(['a', 'b']);
  const { valid, missing } = filterValidEntries(
    [
      { model: 'a', count: 1 },
      { model: 'missing', count: 2 },
      { model: 'b' },
    ],
    available,
  );
  assert.equal(valid.length, 2);
  assert.deepEqual(missing, ['missing']);
});

test('resolveEntriesForApply throws when all desired cars missing (no silent strip)', () => {
  assert.throws(
    () =>
      resolveEntriesForApply(
        [{ model: 'gone' }, { model: 'also_gone' }],
        new Set(['local_only']),
        'server-1',
      ),
    /server-1: no valid cars locally: gone, also_gone/,
  );
});

test('resolveEntriesForApply keeps partial valid entries', () => {
  const out = resolveEntriesForApply(
    [
      { model: 'ok', skin: '0' },
      { model: 'missing' },
    ],
    new Set(['ok']),
    'server-1',
  );
  assert.deepEqual(out, [{ model: 'ok', skin: '0' }]);
});

test('resolveEntriesForApply undefined entries stays undefined', () => {
  assert.equal(resolveEntriesForApply(undefined, new Set(['a']), 's'), undefined);
});

test('resolveEntriesForApply empty array stays empty', () => {
  assert.deepEqual(resolveEntriesForApply([], new Set(['a']), 's'), []);
});
