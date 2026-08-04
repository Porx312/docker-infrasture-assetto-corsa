import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureContentZip,
  getCachedZipSizeIfExists,
  resetContentZipCacheEnvForTests,
  scheduleContentZipBuild,
} from './contentZipCache.js';

test('ensureContentZip builds cache and reuses on second call', async () => {
  const cacheDir = path.join(os.tmpdir(), `ac-zip-cache-${Date.now()}`);
  const modDir = path.join(os.tmpdir(), `ac-mod-${Date.now()}`);
  process.env.CLIENT_SYNC_ZIP_CACHE_PATH = cacheDir;

  await fs.promises.mkdir(modDir, { recursive: true });
  await fs.promises.writeFile(path.join(modDir, 'data.acd'), 'fake-acd-content');

  const modifiedMs = Date.now();
  try {
    const first = await ensureContentZip('cars', 'test_car', modDir, modifiedMs);
    assert.ok(first.sizeBytes > 0);
    assert.ok(fs.existsSync(first.zipPath));

    const cachedSize = await getCachedZipSizeIfExists('cars', 'test_car', modifiedMs);
    assert.equal(cachedSize, first.sizeBytes);

    const second = await ensureContentZip('cars', 'test_car', modDir, modifiedMs);
    assert.equal(second.zipPath, first.zipPath);
    assert.equal(second.sizeBytes, first.sizeBytes);
  } finally {
    delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
    resetContentZipCacheEnvForTests();
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    await fs.promises.rm(modDir, { recursive: true, force: true });
  }
});

test('ensureContentZip creates new file when mtime changes', async () => {
  const cacheDir = path.join(os.tmpdir(), `ac-zip-cache-mtime-${Date.now()}`);
  const modDir = path.join(os.tmpdir(), `ac-mod-mtime-${Date.now()}`);
  process.env.CLIENT_SYNC_ZIP_CACHE_PATH = cacheDir;

  await fs.promises.mkdir(modDir, { recursive: true });
  await fs.promises.writeFile(path.join(modDir, 'data.acd'), 'v1');

  const mtime1 = Date.now();
  const mtime2 = mtime1 + 60_000;

  try {
    const first = await ensureContentZip('cars', 'mtime_car', modDir, mtime1);
    const second = await ensureContentZip('cars', 'mtime_car', modDir, mtime2);
    assert.notEqual(first.zipPath, second.zipPath);
    assert.ok(fs.existsSync(second.zipPath));
    // Older cache version is purged when a new mtime zip is built
    assert.ok(!fs.existsSync(first.zipPath));
  } finally {
    delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
    resetContentZipCacheEnvForTests();
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    await fs.promises.rm(modDir, { recursive: true, force: true });
  }
});

test('ensureContentZip single-flight shares one build for concurrent callers', async () => {
  const cacheDir = path.join(os.tmpdir(), `ac-zip-cache-flight-${Date.now()}`);
  const modDir = path.join(os.tmpdir(), `ac-mod-flight-${Date.now()}`);
  process.env.CLIENT_SYNC_ZIP_CACHE_PATH = cacheDir;

  await fs.promises.mkdir(modDir, { recursive: true });
  await fs.promises.writeFile(path.join(modDir, 'data.acd'), 'flight-test');

  const modifiedMs = Date.now();
  try {
    const [first, second] = await Promise.all([
      ensureContentZip('cars', 'flight_car', modDir, modifiedMs),
      ensureContentZip('cars', 'flight_car', modDir, modifiedMs),
    ]);
    assert.equal(first.zipPath, second.zipPath);
    assert.equal(first.sizeBytes, second.sizeBytes);
  } finally {
    delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
    resetContentZipCacheEnvForTests();
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    await fs.promises.rm(modDir, { recursive: true, force: true });
  }
});

test('scheduleContentZipBuild completes cache for later HEAD stat', async () => {
  const cacheDir = path.join(os.tmpdir(), `ac-zip-cache-sched-${Date.now()}`);
  const modDir = path.join(os.tmpdir(), `ac-mod-sched-${Date.now()}`);
  process.env.CLIENT_SYNC_ZIP_CACHE_PATH = cacheDir;

  await fs.promises.mkdir(modDir, { recursive: true });
  await fs.promises.writeFile(path.join(modDir, 'data.acd'), 'scheduled');

  const modifiedMs = Date.now();
  try {
    scheduleContentZipBuild('cars', 'sched_car', modDir, modifiedMs);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const cachedSize = await getCachedZipSizeIfExists('cars', 'sched_car', modifiedMs);
    assert.ok(cachedSize && cachedSize > 0);
  } finally {
    delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
    resetContentZipCacheEnvForTests();
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    await fs.promises.rm(modDir, { recursive: true, force: true });
  }
});
