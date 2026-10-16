import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  contentHashFromFileEntries,
  hashContentTree,
} from '@projectd/ac-data-shared/mods/contentTreeHash.js';
import { computeNeededAndSkip } from './slimUploadSession.js';

function sha(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('slimUploadSession computeNeededAndSkip', () => {
  it('skips identical pool files and needs changed ones', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-need-'));
    const dest = path.join(root, 'car');
    try {
      await fsp.mkdir(dest, { recursive: true });
      await fsp.writeFile(path.join(dest, 'data.acd'), 'acd-v1', 'utf8');
      await fsp.mkdir(path.join(dest, 'ui'), { recursive: true });
      await fsp.writeFile(path.join(dest, 'ui', 'ui_car.json'), '{}', 'utf8');

      const files = [
        { rel: 'data.acd', size: Buffer.byteLength('acd-v1'), sha256: sha('acd-v1') },
        { rel: 'ui/ui_car.json', size: Buffer.byteLength('{}'), sha256: sha('{}') },
        {
          rel: 'skins/red/ui_skin.json',
          size: Buffer.byteLength('{"c":1}'),
          sha256: sha('{"c":1}'),
        },
      ];

      const { needed, skip } = await computeNeededAndSkip(dest, 'car', files);
      assert.equal(skip.length, 2);
      assert.equal(needed.length, 1);
      assert.equal(needed[0]?.rel, 'skins/red/ui_skin.json');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('treats staging match as skip (resume)', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-stage-'));
    const dest = path.join(root, 'car');
    const staging = path.join(root, 'staging');
    try {
      await fsp.mkdir(dest, { recursive: true });
      await fsp.mkdir(path.join(staging, 'ui'), { recursive: true });
      const payload = 'staged-acd';
      await fsp.writeFile(path.join(staging, 'data.acd'), payload, 'utf8');
      await fsp.writeFile(path.join(staging, 'ui', 'ui_car.json'), '{}', 'utf8');

      const files = [
        { rel: 'data.acd', size: Buffer.byteLength(payload), sha256: sha(payload) },
        { rel: 'ui/ui_car.json', size: Buffer.byteLength('{}'), sha256: sha('{}') },
      ];
      const { needed, skip } = await computeNeededAndSkip(dest, 'car', files, staging);
      assert.equal(needed.length, 0);
      assert.equal(skip.length, 2);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('contentHashFromFileEntries matches hashContentTree slim', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-hash-'));
    try {
      await fsp.writeFile(path.join(dir, 'data.acd'), 'acd', 'utf8');
      await fsp.mkdir(path.join(dir, 'ui'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'ui', 'ui_car.json'), '{}', 'utf8');
      await fsp.writeFile(path.join(dir, 'body.kn5'), 'nope', 'utf8');

      const tree = await hashContentTree(dir, { slimKind: 'car' });
      const entries = [
        { rel: 'data.acd', size: 3, sha256: sha('acd') },
        { rel: 'ui/ui_car.json', size: 2, sha256: sha('{}') },
      ];
      assert.equal(contentHashFromFileEntries(entries), tree.contentHash);

      const replaced = [
        { rel: 'data.acd', size: 3, sha256: sha('acd') },
        { rel: 'ui/ui_car.json', size: 7, sha256: sha('changed') },
      ];
      assert.notEqual(contentHashFromFileEntries(replaced), tree.contentHash);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
