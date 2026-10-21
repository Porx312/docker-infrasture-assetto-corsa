import assert from 'node:assert/strict';
import test from 'node:test';

import { artifactTarGzStorageKey } from '@projectd/ac-data-shared/mods/modS3Manifest.js';
import { storageMode } from '../../../src/services/mods/objectStorage.js';

test('storageMode defaults to local', () => {
  const prev = process.env.MOD_STORAGE_MODE;
  try {
    delete process.env.MOD_STORAGE_MODE;
    assert.equal(storageMode(), 'local');
    process.env.MOD_STORAGE_MODE = 's3';
    assert.equal(storageMode(), 's3');
  } finally {
    if (prev === undefined) delete process.env.MOD_STORAGE_MODE;
    else process.env.MOD_STORAGE_MODE = prev;
  }
});

test('canonical tar.gz key matches shared helper', () => {
  const h = 'f'.repeat(64);
  assert.match(artifactTarGzStorageKey(h), /^artifacts\/sha256\/ff\/ff\/f+\.tar\.gz$/);
});
