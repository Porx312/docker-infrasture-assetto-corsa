/**
 * ZIP library upload: path safety, content root, slim tree, link/dedupe.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { closeModPool, getModPool, isModDbConfigured } from './db.js';
import { runModMigrationsIfConfigured } from './migrate.js';
import {
  _isUnsafeZipEntryPathForTests,
  extractZipSafe,
  materializeSlimTree,
  processLibraryZipUpload,
  resolveContentRoot,
} from './hubLibraryZipUpload.js';
import { countPackageSteamLinks } from './modSteamLinks.js';

const hasDb = isModDbConfigured();

test('rejects path traversal zip entry paths', () => {
  assert.equal(_isUnsafeZipEntryPathForTests('../evil'), true);
  assert.equal(_isUnsafeZipEntryPathForTests('foo/../../etc/passwd'), true);
  assert.equal(_isUnsafeZipEntryPathForTests('/abs/path'), true);
  assert.equal(_isUnsafeZipEntryPathForTests('cars/my_car/data.acd'), false);
  assert.equal(_isUnsafeZipEntryPathForTests('data.acd'), false);
});

async function makeCarZip(slug: string): Promise<{ zipPath: string; work: string }> {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-car-'));
  const root = path.join(work, slug);
  await fsp.mkdir(path.join(root, 'ui'), { recursive: true });
  await fsp.writeFile(path.join(root, 'data.acd'), 'fake-acd-bytes');
  await fsp.writeFile(path.join(root, 'ui', 'ui_car.json'), '{"name":"test"}');
  // non-slim file should be ignored by materialize
  await fsp.writeFile(path.join(root, 'body.kn5'), 'huge');
  const zipPath = path.join(work, `${slug}.zip`);
  const z = spawnSync(
    'python3',
    [
      '-c',
      `
import zipfile, os, sys
work, zip_path, slug = sys.argv[1], sys.argv[2], sys.argv[3]
car_root = os.path.join(work, slug)
with zipfile.ZipFile(zip_path, 'w') as z:
    for dirpath, _, files in os.walk(car_root):
        for name in files:
            full = os.path.join(dirpath, name)
            arc = os.path.join(slug, os.path.relpath(full, car_root)).replace(os.sep, '/')
            z.write(full, arc)
`,
      work,
      zipPath,
      slug,
    ],
    { encoding: 'utf8' },
  );
  if (z.status !== 0) {
    throw new Error(`zip failed: ${z.stderr || z.stdout}`);
  }
  return { zipPath, work };
}

test('extractZipSafe rejects traversal entries', async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-trav-'));
  try {
    // Craft a zip with unsafe name via zip - may store as-is; simulate extract check
    const evilDir = path.join(work, 'out');
    await fsp.mkdir(evilDir, { recursive: true });
    // Create a minimal zip with a normal file, then unit-test isUnsafe separately;
    // extract of crafted zip: write a zip using Python if zip CLI normalizes ..
    const py = spawnSync(
      'python3',
      [
        '-c',
        `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], 'w')
z.writestr('../evil.txt', 'x')
z.close()
`,
        path.join(work, 'evil.zip'),
      ],
      { encoding: 'utf8' },
    );
    if (py.status !== 0) {
      // skip if python zip fails
      return;
    }
    await assert.rejects(
      () => extractZipSafe(path.join(work, 'evil.zip'), evilDir),
      (err: unknown) => err instanceof Error && err.message.startsWith('unsafe_zip_path'),
    );
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
});

test('resolveContentRoot + materializeSlimTree keeps only slim files', async () => {
  const { zipPath, work } = await makeCarZip('my_custom');
  const extractDir = path.join(work, 'extract');
  try {
    await extractZipSafe(zipPath, extractDir);
    const { contentRoot, slug } = await resolveContentRoot(extractDir, 'car');
    assert.equal(slug, 'my_custom');
    const slimDir = path.join(work, 'slim', slug);
    const rels = await materializeSlimTree(contentRoot, 'car', slimDir);
    assert.ok(rels.includes('data.acd'));
    assert.ok(rels.includes('ui/ui_car.json'));
    assert.ok(!rels.includes('body.kn5'));
    assert.ok(fs.existsSync(path.join(slimDir, 'data.acd')));
    assert.equal(fs.existsSync(path.join(slimDir, 'body.kn5')), false);
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
});

test('processLibraryZipUpload links two steams; second is already_present', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  if ((process.env.MOD_STORAGE_MODE || '').trim() !== 's3') {
    t.skip('MOD_STORAGE_MODE=s3 required');
    return;
  }
  await runModMigrationsIfConfigured();
  const { zipPath, work } = await makeCarZip(`zip_${randomUUID().slice(0, 8)}`);
  const steamA = '76561199000000101';
  const steamB = '76561199000000102';

  const prevFetch = globalThis.fetch;
  // If S3 put tries network, allow failure paths — mock put via env may still need AWS.
  // Prefer already_present path: first upload may fail without S3 creds.
  // Seed by first successful process or skip on s3 errors.
  try {
    let first;
    try {
      first = await processLibraryZipUpload({
        zipPath,
        steamId: steamA,
        kind: 'car',
        displayName: 'Zip Car',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('S3') ||
        message.includes('s3') ||
        message.includes('credentials') ||
        message.includes('AccessDenied') ||
        message.includes('ENOTFOUND')
      ) {
        t.skip(`S3 unavailable: ${message}`);
        return;
      }
      throw err;
    }
    assert.ok(first.status === 'uploaded' || first.status === 'already_present');
    assert.equal(first.linked, true);

    const second = await processLibraryZipUpload({
      zipPath,
      steamId: steamB,
      kind: 'car',
    });
    assert.equal(second.status, 'already_present');
    assert.equal(second.packageId, first.packageId);
    assert.equal(await countPackageSteamLinks(first.packageId), 2);
  } finally {
    globalThis.fetch = prevFetch;
    resetFleetRegistryForTests();
    await fsp.rm(work, { recursive: true, force: true });
    await closeModPool().catch(() => undefined);
  }
});
