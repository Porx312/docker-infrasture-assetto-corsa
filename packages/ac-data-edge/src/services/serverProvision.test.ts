import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  copyDirRecursiveForTest,
  deprovisionServerInstance,
  ensureInstanceLinks,
  rewriteAbsoluteSymlinkTarget,
} from './serverProvision.js';

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

test('rewriteAbsoluteSymlinkTarget maps /home/jose paths to servers root layout', () => {
  const serversRoot = '/root/assetto-infra/server';
  assert.equal(
    rewriteAbsoluteSymlinkTarget('/home/jose/assetto-infra/server/acServer', serversRoot),
    '/root/assetto-infra/server/acServer',
  );
  assert.equal(
    rewriteAbsoluteSymlinkTarget('/home/jose/assetto-install/content/cars', serversRoot),
    '/root/assetto-install/content/cars',
  );
  assert.equal(rewriteAbsoluteSymlinkTarget('../acServer', serversRoot), '../acServer');
});

test('ensureInstanceLinks creates relative ../acServer', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-links-'));
  const prev = process.env.SERVERS_PATH;
  process.env.SERVERS_PATH = tmp;
  try {
    await fsp.writeFile(path.join(tmp, 'acServer'), 'fake-bin');
    await fsp.mkdir(path.join(tmp, 'system'), { recursive: true });
    const inst = path.join(tmp, 'server');
    await fsp.mkdir(inst, { recursive: true });
    // Broken absolute link like Contabo clones
    await fsp.symlink('/home/jose/assetto-infra/server/acServer', path.join(inst, 'acServer'));

    ensureInstanceLinks(inst, tmp);

    const link = path.join(inst, 'acServer');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.readlinkSync(link), '../acServer');
    assert.ok(fs.existsSync(link), 'relative link must resolve');
    assert.equal(fs.readlinkSync(path.join(inst, 'system')), '../system');
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('copyDirRecursive rewrites jose abs symlink then ensureInstanceLinks wins for acServer', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-clone-'));
  const prev = process.env.SERVERS_PATH;
  process.env.SERVERS_PATH = tmp;
  try {
    await fsp.writeFile(path.join(tmp, 'acServer'), 'bin');
    const src = path.join(tmp, 'template');
    await fsp.mkdir(src, { recursive: true });
    await fsp.symlink(
      '/home/jose/assetto-infra/server/acServer',
      path.join(src, 'acServer'),
    );
    const dest = path.join(tmp, 'server-9');
    copyDirRecursiveForTest(src, dest, tmp);
    assert.equal(
      fs.readlinkSync(path.join(dest, 'acServer')),
      path.join(tmp, 'acServer'),
    );
    ensureInstanceLinks(dest, tmp);
    assert.equal(fs.readlinkSync(path.join(dest, 'acServer')), '../acServer');
    assert.ok(fs.existsSync(path.join(dest, 'acServer')));
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('deprovisionServerInstance rejects unsafe names', async () => {
  const prev = process.env.SERVERS_PATH;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-deprov-'));
  process.env.SERVERS_PATH = tmp;
  try {
    await assert.rejects(
      () => deprovisionServerInstance('../etc'),
      /Invalid server name/,
    );
    await assert.rejects(
      () => deprovisionServerInstance('server-template'),
      /Invalid server name/,
    );
    await assert.rejects(
      () => deprovisionServerInstance('server-99'),
      /not found/,
    );
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('deprovisionServerInstance removes folder', async () => {
  const prev = process.env.SERVERS_PATH;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-deprov-'));
  process.env.SERVERS_PATH = tmp;
  try {
    const dir = path.join(tmp, 'server-3');
    await fsp.mkdir(path.join(dir, 'cfg'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'cfg', 'server_cfg.ini'), 'NAME=x\n');
    const result = await deprovisionServerInstance('server-3');
    assert.equal(result.serverName, 'server-3');
    assert.equal(fs.existsSync(dir), false);
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
