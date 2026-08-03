import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveSafeHudFilename, validateZipFile } from './projectdHudManager.js';

test('resolveSafeHudFilename accepts zip basename', () => {
  assert.equal(resolveSafeHudFilename('projectd-hud-v1.0.0.zip'), 'projectd-hud-v1.0.0.zip');
});

test('resolveSafeHudFilename rejects path traversal', () => {
  assert.equal(resolveSafeHudFilename('../evil.zip'), null);
  assert.equal(resolveSafeHudFilename('sub/release.zip'), null);
});

test('resolveSafeHudFilename rejects non-zip', () => {
  assert.equal(resolveSafeHudFilename('readme.txt'), null);
});

test('validateZipFile rejects tiny files', async () => {
  const filePath = path.join(os.tmpdir(), `hud-tiny-${Date.now()}.zip`);
  await fs.promises.writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  try {
    const result = await validateZipFile(filePath);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /too small/i);
    }
  } finally {
    await fs.promises.unlink(filePath).catch(() => {});
  }
});

test('validateZipFile accepts minimal zip header', async () => {
  const filePath = path.join(os.tmpdir(), `hud-ok-${Date.now()}.zip`);
  const buf = Buffer.alloc(22, 0x00);
  buf[0] = 0x50;
  buf[1] = 0x4b;
  buf[2] = 0x03;
  buf[3] = 0x04;
  await fs.promises.writeFile(filePath, buf);
  try {
    const result = await validateZipFile(filePath);
    assert.equal(result.ok, true);
  } finally {
    await fs.promises.unlink(filePath).catch(() => {});
  }
});
