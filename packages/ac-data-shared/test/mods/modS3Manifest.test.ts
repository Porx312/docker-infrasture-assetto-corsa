import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactTarGzStorageKey,
  isModPeerPullEnabled,
  isModS3CanonicalUploadEnabled,
  isModS3PullEnabled,
  isS3CanonicalStorageKey,
  mergeModS3FieldsIntoManifest,
  MOD_S3_FORMAT_TAR_GZ,
  readModS3Fields,
  s3CanonicalStorageKey,
} from '../../src/mods/modS3Manifest.js';

test('artifactTarGzStorageKey nests by hash prefix', () => {
  const h = 'a'.repeat(64);
  assert.equal(artifactTarGzStorageKey(h), `artifacts/sha256/aa/aa/${h}.tar.gz`);
});

test('s3CanonicalStorageKey round-trips', () => {
  const h = 'c'.repeat(64);
  const key = s3CanonicalStorageKey(h);
  assert.equal(key, `s3-canonical:${h}`);
  assert.equal(isS3CanonicalStorageKey(key), true);
  assert.equal(isS3CanonicalStorageKey('edge-folder:eu:car:x:' + h), false);
});

test('readModS3Fields rejects invalid or incomplete refs', () => {
  assert.equal(readModS3Fields(null), null);
  assert.equal(readModS3Fields({}), null);
  assert.equal(
    readModS3Fields({
      s3Key: 'bad',
      s3Sha256: 'a'.repeat(64),
      s3SizeBytes: 1,
      s3Format: MOD_S3_FORMAT_TAR_GZ,
    }),
    null,
  );
  assert.equal(
    readModS3Fields({
      s3Key: artifactTarGzStorageKey('b'.repeat(64)),
      s3Sha256: 'not-a-hash',
      s3SizeBytes: 10,
      s3Format: MOD_S3_FORMAT_TAR_GZ,
    }),
    null,
  );
  assert.equal(
    readModS3Fields({
      s3Key: artifactTarGzStorageKey('c'.repeat(64)),
      s3Sha256: 'c'.repeat(64),
      s3SizeBytes: 0,
      s3Format: MOD_S3_FORMAT_TAR_GZ,
    }),
    null,
  );
});

test('readModS3Fields accepts validated canonical ref', () => {
  const h = 'd'.repeat(64);
  const fields = readModS3Fields({
    s3Key: artifactTarGzStorageKey(h),
    s3Sha256: h,
    s3SizeBytes: 42,
    s3Format: MOD_S3_FORMAT_TAR_GZ,
  });
  assert.ok(fields);
  assert.equal(fields!.s3SizeBytes, 42);
  assert.equal(fields!.s3Format, MOD_S3_FORMAT_TAR_GZ);
});

test('mergeModS3FieldsIntoManifest keeps other manifest keys', () => {
  const h = 'e'.repeat(64);
  const out = mergeModS3FieldsIntoManifest(
    { acContentSlugs: ['x'], kind: 'car', rootPaths: [] },
    {
      s3Key: artifactTarGzStorageKey(h),
      s3Sha256: h,
      s3SizeBytes: 9,
      s3Format: MOD_S3_FORMAT_TAR_GZ,
    },
  );
  assert.deepEqual(out.acContentSlugs, ['x']);
  assert.equal(out.s3Key, artifactTarGzStorageKey(h));
});

test('feature flags default off', () => {
  assert.equal(isModS3CanonicalUploadEnabled({}), false);
  assert.equal(isModS3PullEnabled({}), false);
  assert.equal(isModPeerPullEnabled({}), false);
  assert.equal(isModS3CanonicalUploadEnabled({ MOD_S3_CANONICAL_UPLOAD: '1' }), true);
  assert.equal(isModS3PullEnabled({ MOD_S3_PULL_ENABLED: '1' }), true);
  assert.equal(isModPeerPullEnabled({ MOD_PEER_PULL_ENABLED: '1' }), true);
});
