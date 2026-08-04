import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  buildLauncherContentEntriesForNames,
  buildLauncherContentEntryForName,
  computeContentVersion,
  missingLauncherContentEntry,
  prepareContentDownloadHead,
  toLauncherContentEntry,
  type ContentManifestEntry,
} from './contentSyncService.js';
import { resetContentZipCacheEnvForTests } from './contentZipCache.js';

function sampleEntry(overrides: Partial<ContentManifestEntry> = {}): ContentManifestEntry {
  return {
    name: 'test_car',
    sizeBytes: 1000,
    modifiedAt: '2026-01-01T12:00:00.000Z',
    fileCount: 5,
    isEmpty: false,
    hasAcd: true,
    hasKn5: false,
    isDirectory: true,
    distribution: 'launcher',
    downloadable: true,
    steamStoreUrl: null,
    displayName: null,
    zipSizeBytes: 500,
    ...overrides,
  };
}

test('toLauncherContentEntry strips operator-only fields', () => {
  const publicEntry = toLauncherContentEntry(sampleEntry());
  assert.deepEqual(publicEntry, {
    name: 'test_car',
    modifiedAt: '2026-01-01T12:00:00.000Z',
    distribution: 'launcher',
    downloadable: true,
    steamStoreUrl: null,
    displayName: null,
    zipSizeBytes: 500,
  });
  assert.ok(!('isEmpty' in publicEntry));
  assert.ok(!('hasAcd' in publicEntry));
  assert.ok(!('fileCount' in publicEntry));
});

test('computeContentVersion returns max modifiedAt across groups', () => {
  const cars = [
    toLauncherContentEntry(sampleEntry({ modifiedAt: '2026-01-01T12:00:00.000Z' })),
    toLauncherContentEntry(sampleEntry({ modifiedAt: '2026-03-15T08:30:00.000Z' })),
  ];
  const tracks = [
    toLauncherContentEntry(sampleEntry({ modifiedAt: '2026-02-10T00:00:00.000Z' })),
  ];
  assert.equal(computeContentVersion(cars, tracks), '2026-03-15T08:30:00.000Z');
});

test('computeContentVersion returns null for empty lists', () => {
  assert.equal(computeContentVersion([], []), null);
});

const originalContentPath = process.env.CONTENT_PATH;
let tempContentPath: string | null = null;

afterEach(() => {
  if (tempContentPath && fs.existsSync(tempContentPath)) {
    fs.rmSync(tempContentPath, { recursive: true, force: true });
    tempContentPath = null;
  }
  if (originalContentPath === undefined) {
    delete process.env.CONTENT_PATH;
  } else {
    process.env.CONTENT_PATH = originalContentPath;
  }
});

test('buildLauncherContentEntriesForNames resolves only requested ids', async () => {
  tempContentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'content-targeted-'));
  process.env.CONTENT_PATH = tempContentPath;

  const carDir = path.join(tempContentPath, 'cars', 'test_car_only');
  fs.mkdirSync(carDir, { recursive: true });
  fs.writeFileSync(path.join(carDir, 'data.acd'), 'acd', 'utf-8');
  const mtime = new Date('2026-02-01T10:00:00.000Z');
  fs.utimesSync(carDir, mtime, mtime);

  const entries = await buildLauncherContentEntriesForNames('cars', [
    'test_car_only',
    'missing_car',
    'test_car_only',
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.name, 'test_car_only');
  assert.equal(entries[0]?.downloadable, true);
  assert.equal(entries[0]?.modifiedAt, mtime.toISOString());
  assert.equal(entries[1]?.name, 'missing_car');
  assert.equal(entries[1]?.downloadable, false);
});

test('buildLauncherContentEntryForName returns missing entry when mod absent', async () => {
  tempContentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'content-missing-'));
  process.env.CONTENT_PATH = tempContentPath;
  fs.mkdirSync(path.join(tempContentPath, 'tracks'), { recursive: true });

  const entry = await buildLauncherContentEntryForName('tracks', 'no_such_track');
  assert.equal(entry.name, 'no_such_track');
  assert.equal(entry.downloadable, false);
});

test('missingLauncherContentEntry marks mod unavailable on VPS', () => {
  const entry = missingLauncherContentEntry('cars', 'ghost_car');
  assert.equal(entry.name, 'ghost_car');
  assert.equal(entry.downloadable, false);
  assert.equal(entry.zipSizeBytes, null);
});

test('prepareContentDownloadHead returns 503 zip_building on cold cache', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-head-'));
  tempContentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'content-head-mod-'));
  process.env.CONTENT_PATH = tempContentPath;
  process.env.CLIENT_SYNC_ZIP_CACHE_PATH = cacheDir;

  const trackDir = path.join(tempContentPath, 'tracks', 'cold_track');
  fs.mkdirSync(trackDir, { recursive: true });
  fs.writeFileSync(path.join(trackDir, 'data.acd'), 'acd', 'utf-8');

  try {
    const head = await prepareContentDownloadHead('tracks', 'cold_track');
    assert.equal(head.ok, false);
    if (!head.ok) {
      assert.equal(head.status, 503);
      assert.equal(head.body.reason, 'zip_building');
    }
  } finally {
    delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
    resetContentZipCacheEnvForTests();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
