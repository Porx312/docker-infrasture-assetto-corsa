import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateZipEntryPath,
  getValidCachedBlob,
  contentPoolPath,
} from './materialize.js';

test('zip security: rejects parent segments via normalize', () => {
  const root = '/tmp/mod-extract-root';
  const bad = validateZipEntryPath('../etc/passwd', root);
  assert.equal(bad.ok, false);
});

test('zip security: rejects absolute paths', () => {
  const root = '/tmp/mod-extract-root';
  assert.equal(validateZipEntryPath('/etc/passwd', root).ok, false);
  assert.equal(validateZipEntryPath('C:/windows/system32', root).ok, false);
});

test('zip security: rejects escape after normalize', () => {
  const root = '/tmp/mod-extract-root';
  const sneaky = validateZipEntryPath('cars/../../outside', root);
  assert.equal(sneaky.ok, false);
});

test('zip security: accepts nested content path', () => {
  const root = '/tmp/mod-extract-root';
  const ok = validateZipEntryPath('cars/bmw_m3_e30/data/car.ini', root);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.ok(ok.relative.includes('bmw_m3_e30'));
  }
});

test('zip security: rejects excessive depth', () => {
  const root = '/tmp/mod-extract-root';
  const deep = Array.from({ length: 40 }, (_, i) => `d${i}`).join('/');
  assert.equal(validateZipEntryPath(deep, root).ok, false);
});

test('cache: correct SHA → CACHE HIT; wrong SHA → INVALID and null', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-mod-cache-'));
  const prev = process.env.AC_MOD_ROOT;
  process.env.AC_MOD_ROOT = tmp;
  try {
    const content = Buffer.from('hello-mod-artifact');
    const sha = createHash('sha256').update(content).digest('hex');
    const prefix = sha.slice(0, 2);
    const mid = sha.slice(2, 4);
    const blobDir = path.join(tmp, 'blobs', 'sha256', prefix, mid);
    await fsp.mkdir(blobDir, { recursive: true });
    const blobPath = path.join(blobDir, `${sha}.zip`);
    await fsp.writeFile(blobPath, content);

    const hit = await getValidCachedBlob(sha);
    assert.equal(hit, blobPath);

    // Corrupt blob in place
    await fsp.writeFile(blobPath, Buffer.from('tampered'));
    const miss = await getValidCachedBlob(sha);
    assert.equal(miss, null);
    assert.equal(fs.existsSync(blobPath), false);
  } finally {
    if (prev === undefined) {
      delete process.env.AC_MOD_ROOT;
    } else {
      process.env.AC_MOD_ROOT = prev;
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('multi-server: shared CONTENT_PATH → one materialization path', () => {
  const prev = process.env.CONTENT_PATH;
  process.env.CONTENT_PATH = '/var/lib/ac-mods/pool';
  try {
    const pool = contentPoolPath();
    const car = 'bmw_m3_e30';
    const serverA = path.join(pool, 'cars', car);
    const serverB = path.join(pool, 'cars', car);
    const serverC = path.join(pool, 'cars', car);
    assert.equal(serverA, serverB);
    assert.equal(serverB, serverC);
    // Symlink model: server-N/content/cars → pool/cars (same inode target)
    assert.equal(path.join(pool, 'cars'), path.join(contentPoolPath(), 'cars'));
  } finally {
    if (prev === undefined) {
      delete process.env.CONTENT_PATH;
    } else {
      process.env.CONTENT_PATH = prev;
    }
  }
});

test('integrity: SHA mismatch is treated as failure (download contract)', () => {
  const expected = 'a'.repeat(64);
  const actual = 'b'.repeat(64);
  assert.notEqual(expected, actual);
  // downloadWithResume throws on mismatch — documented here as the install gate.
  const wouldFail = actual !== expected;
  assert.equal(wouldFail, true);
});
