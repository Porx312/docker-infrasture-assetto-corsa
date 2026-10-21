/**
 * Documents distinct S3 pull failure messages (orchestrator s3PullBlockedError contract).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactTarGzStorageKey,
  isModS3PullEnabled,
  MOD_S3_FORMAT_TAR_GZ,
  readModS3Fields,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';

test('validated s3 fields distinguishable from pull-flag off', () => {
  const h = 'a'.repeat(64);
  const manifest = {
    s3Key: artifactTarGzStorageKey(h),
    s3Sha256: 'b'.repeat(64),
    s3SizeBytes: 10,
    s3Format: MOD_S3_FORMAT_TAR_GZ,
  };
  assert.ok(readModS3Fields(manifest));
  const prev = process.env.MOD_S3_PULL_ENABLED;
  delete process.env.MOD_S3_PULL_ENABLED;
  assert.equal(isModS3PullEnabled(), false);
  if (prev !== undefined) process.env.MOD_S3_PULL_ENABLED = prev;
});

test('missing s3Key is a distinct validation failure', () => {
  assert.equal(readModS3Fields({}), null);
  assert.equal(readModS3Fields({ s3Key: 'nope' }), null);
});
