import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { contentHashFromFileEntries, hashContentTree } from './contentTreeHash.js';
import crypto from 'node:crypto';

describe('hashContentTree', () => {
  it('is stable for same tree and ignores .acmod.json', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-hash-'));
    try {
      await fsp.writeFile(path.join(dir, 'data.ini'), 'x=1\n', 'utf8');
      await fsp.mkdir(path.join(dir, 'skins', 'red'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'skins', 'red', 'livery.png'), 'png', 'utf8');
      const a = await hashContentTree(dir);
      await fsp.writeFile(
        path.join(dir, '.acmod.json'),
        JSON.stringify({ artifactId: 'x', contentHash: a.contentHash }),
        'utf8',
      );
      const b = await hashContentTree(dir);
      assert.equal(a.contentHash, b.contentHash);
      assert.equal(a.fileCount, 2);
      assert.equal(b.fileCount, 2);
      assert.ok(/^[a-f0-9]{64}$/.test(a.contentHash));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('contentHashFromFileEntries matches on-disk slim hash', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-hash-entries-'));
    try {
      const acd = 'pack-acd';
      await fsp.writeFile(path.join(dir, 'data.acd'), acd, 'utf8');
      const tree = await hashContentTree(dir, { slimKind: 'car' });
      const sha = crypto.createHash('sha256').update(acd, 'utf8').digest('hex');
      assert.equal(
        contentHashFromFileEntries([{ rel: 'data.acd', size: Buffer.byteLength(acd), sha256: sha }]),
        tree.contentHash,
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('server-slim hash ignores kn5 but keeps data.acd', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-hash-slim-'));
    try {
      await fsp.writeFile(path.join(dir, 'data.acd'), 'acd', 'utf8');
      await fsp.mkdir(path.join(dir, 'skins', 'red'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'skins', 'red', 'ui_skin.json'), '{}', 'utf8');
      await fsp.writeFile(path.join(dir, 'skins', 'red', 'body.kn5'), 'huge', 'utf8');
      const slimA = await hashContentTree(dir, { slimKind: 'car' });
      await fsp.writeFile(path.join(dir, 'skins', 'red', 'body.kn5'), 'changed-huge', 'utf8');
      const slimB = await hashContentTree(dir, { slimKind: 'car' });
      assert.equal(slimA.contentHash, slimB.contentHash);
      assert.equal(slimA.fileCount, 2);
      const full = await hashContentTree(dir);
      assert.notEqual(full.contentHash, slimA.contentHash);
      assert.ok(full.fileCount > slimA.fileCount);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
