import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyDirRecursiveForTest } from './serverProvision.js';

test('copyDirRecursive preserves symlink-to-directory (no EISDIR)', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-provision-'));
  try {
    const sharedCars = path.join(tmp, 'shared-cars');
    await fsp.mkdir(sharedCars, { recursive: true });
    await fsp.writeFile(path.join(sharedCars, 'marker.txt'), 'ok');

    const src = path.join(tmp, 'template');
    const srcContent = path.join(src, 'content');
    await fsp.mkdir(srcContent, { recursive: true });
    await fsp.symlink(sharedCars, path.join(srcContent, 'cars'));
    await fsp.writeFile(path.join(src, 'cfg.ini'), 'NAME=test');
    // Mode-0000 results must not break provision (skip copy).
    const lockedResults = path.join(src, 'results');
    await fsp.mkdir(lockedResults, { recursive: true });
    await fsp.writeFile(path.join(lockedResults, 'junk.json'), '{}');
    await fsp.chmod(lockedResults, 0o000);

    const dest = path.join(tmp, 'server-25');
    copyDirRecursiveForTest(src, dest);

    const destCars = path.join(dest, 'content', 'cars');
    assert.ok(fs.lstatSync(destCars).isSymbolicLink(), 'cars should remain a symlink');
    assert.equal(fs.readlinkSync(destCars), sharedCars);
    assert.equal(fs.readFileSync(path.join(destCars, 'marker.txt'), 'utf8'), 'ok');
    assert.equal(fs.readFileSync(path.join(dest, 'cfg.ini'), 'utf8'), 'NAME=test');
    assert.equal(fs.existsSync(path.join(dest, 'results')), false);
  } finally {
    try {
      await fsp.chmod(path.join(tmp, 'template', 'results'), 0o755);
    } catch {
      /* ignore */
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
