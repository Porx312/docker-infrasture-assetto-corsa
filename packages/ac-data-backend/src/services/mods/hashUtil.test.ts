import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256File, sha256String } from './hashUtil.js';

test('sha256String is deterministic', () => {
  assert.equal(
    sha256String('hello'),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  );
});

test('sha256File matches string hash', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mod-hash-'));
  const file = path.join(dir, 'a.bin');
  await fs.writeFile(file, 'hello');
  const fileHash = await sha256File(file);
  assert.equal(fileHash, sha256String('hello'));
  await fs.rm(dir, { recursive: true, force: true });
});
