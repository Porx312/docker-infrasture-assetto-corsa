/**
 * s3_canonical artifacts install via ensure when manifest has validated s3Key.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isS3CanonicalStorageKey,
  readModS3Fields,
  s3CanonicalStorageKey,
  artifactTarGzStorageKey,
  MOD_S3_FORMAT_TAR_GZ,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';

test('library artifact key is not edge-owned shape', () => {
  const h = 'd'.repeat(64);
  const key = s3CanonicalStorageKey(h);
  assert.equal(isS3CanonicalStorageKey(key), true);
});

test('validated s3 fields required for library install contract', () => {
  const h = 'e'.repeat(64);
  const manifest = {
    s3Key: artifactTarGzStorageKey(h),
    s3Sha256: 'f'.repeat(64),
    s3SizeBytes: 1234,
    s3Format: MOD_S3_FORMAT_TAR_GZ,
  };
  const fields = readModS3Fields(manifest);
  assert.ok(fields);
  assert.equal(fields.s3Key, artifactTarGzStorageKey(h));
});
