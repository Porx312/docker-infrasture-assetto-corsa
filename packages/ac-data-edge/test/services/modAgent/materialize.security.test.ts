import assert from 'node:assert/strict';
import test from 'node:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contentPoolPath, verifyPoolSlug } from '../../../src/services/modAgent/materialize.js';

test('contentPoolPath requires CONTENT_PATH', () => {
  const prev = process.env.CONTENT_PATH;
  delete process.env.CONTENT_PATH;
  assert.throws(() => contentPoolPath(), /CONTENT_PATH/);
  if (prev === undefined) delete process.env.CONTENT_PATH;
  else process.env.CONTENT_PATH = prev;
});

test('verifyPoolSlug checks CONTENT_PATH folder', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mat-'));
  process.env.CONTENT_PATH = root;
  await fsp.mkdir(path.join(root, 'cars', 'my_car'), { recursive: true });
  const ok = await verifyPoolSlug(
    { kind: 'car', contentTypeFolder: 'cars', acContentSlugs: ['my_car'], rootPaths: [] },
    'my_car',
  );
  assert.equal(ok, true);
  const miss = await verifyPoolSlug(
    { kind: 'car', contentTypeFolder: 'cars', acContentSlugs: ['nope'], rootPaths: [] },
    'nope',
  );
  assert.equal(miss, false);
  await fsp.rm(root, { recursive: true, force: true });
});
