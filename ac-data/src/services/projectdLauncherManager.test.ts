import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  deleteLauncherRelease,
  resolveSafeLauncherFilename,
  uploadLauncherRelease,
} from './projectdLauncherManager.js';

test('resolveSafeLauncherFilename accepts zip basename', () => {
  assert.equal(
    resolveSafeLauncherFilename('projectd-launcher-v1.0.0.zip'),
    'projectd-launcher-v1.0.0.zip',
  );
});

test('resolveSafeLauncherFilename rejects path traversal', () => {
  assert.equal(resolveSafeLauncherFilename('../evil.zip'), null);
  assert.equal(resolveSafeLauncherFilename('sub/release.zip'), null);
});

test('resolveSafeLauncherFilename rejects non-zip', () => {
  assert.equal(resolveSafeLauncherFilename('readme.txt'), null);
});

test('uploadLauncherRelease stores windows platform and sha256', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'launcher-upload-'));
  const tempZip = path.join(tempDir, 'upload.zip');
  const buf = Buffer.alloc(22, 0x00);
  buf[0] = 0x50;
  buf[1] = 0x4b;
  buf[2] = 0x03;
  buf[3] = 0x04;
  await fs.promises.writeFile(tempZip, buf);

  const prevPath = process.env.PROJECTD_LAUNCHER_PATH;
  const launcherRoot = path.join(tempDir, 'projectd-launcher');
  process.env.PROJECTD_LAUNCHER_PATH = launcherRoot;

  try {
    const result = await uploadLauncherRelease(tempZip, 'projectd-launcher-v1.0.0.zip');
    assert.equal(result.ok, true);
    assert.equal(result.release?.platform, 'windows');
    assert.match(result.release?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(result.release?.version, 'v1.0.0');

    const deleted = await deleteLauncherRelease('projectd-launcher-v1.0.0.zip');
    assert.equal(deleted.ok, true);
  } finally {
    if (prevPath === undefined) {
      delete process.env.PROJECTD_LAUNCHER_PATH;
    } else {
      process.env.PROJECTD_LAUNCHER_PATH = prevPath;
    }
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});
