import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isEmptyMod, modHasContentFiles } from './contentEmptyDetector.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ac-empty-mod-'));
  try {
    await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('modHasContentFiles detects kn5 and acd', async () => {
  await withTempDir(async (dir) => {
    await fs.promises.mkdir(path.join(dir, 'skins', 'default'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'skins', 'default', 'preview.jpg'), 'x');
    let stats = await modHasContentFiles(dir);
    assert.equal(stats.hasKn5, false);
    assert.equal(stats.hasAcd, false);

    await fs.promises.writeFile(path.join(dir, 'body.kn5'), 'mesh');
    stats = await modHasContentFiles(dir);
    assert.equal(stats.hasKn5, true);

    await fs.promises.writeFile(path.join(dir, 'data.acd'), 'pack');
    stats = await modHasContentFiles(dir);
    assert.equal(stats.hasAcd, true);
  });
});

test('isEmptyMod true for preview-only folder', async () => {
  await withTempDir(async (dir) => {
    await fs.promises.mkdir(path.join(dir, 'ui', 'default'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'ui', 'default', 'preview.png'), 'img');
    assert.equal(await isEmptyMod(dir, true), true);
  });
});

test('isEmptyMod false when kn5 present', async () => {
  await withTempDir(async (dir) => {
    await fs.promises.writeFile(path.join(dir, 'track.kn5'), 'mesh');
    assert.equal(await isEmptyMod(dir, true), false);
  });
});

test('isEmptyMod treats loose ini file as empty', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'placeholder.ini');
    await fs.promises.writeFile(file, '[INFO]');
    assert.equal(await isEmptyMod(file, false), true);
  });
});
