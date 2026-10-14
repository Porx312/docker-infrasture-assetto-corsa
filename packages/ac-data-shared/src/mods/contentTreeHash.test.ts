import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { hashContentTree } from './contentTreeHash.js';

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
});
