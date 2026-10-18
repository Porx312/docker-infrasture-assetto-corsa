import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isModPeerPullEnabled,
  isModS3PullEnabled,
  readModS3Fields,
  artifactTarGzStorageKey,
  MOD_S3_FORMAT_TAR_GZ,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';

/**
 * Documents install-source policy used by orchestrator acquire/ensure:
 * S3 when pull enabled + validated manifest; peer only when MOD_PEER_PULL_ENABLED=1.
 */
function resolveRemoteSource(opts: {
  env: NodeJS.ProcessEnv;
  storageMode: 'local' | 's3';
  manifest: unknown;
  peerReady: boolean;
  peerIsSelf: boolean;
}): 'local' | 's3' | 'peer' | 'error' {
  if (opts.peerIsSelf) return 'local';
  const s3Ok =
    isModS3PullEnabled(opts.env) &&
    opts.storageMode === 's3' &&
    Boolean(readModS3Fields(opts.manifest));
  if (s3Ok) return 's3';
  if (isModPeerPullEnabled(opts.env) && opts.peerReady) return 'peer';
  return 'error';
}

const sampleManifest = () => {
  const h = 'a'.repeat(64);
  return {
    s3Key: artifactTarGzStorageKey(h),
    s3Sha256: h,
    s3SizeBytes: 100,
    s3Format: MOD_S3_FORMAT_TAR_GZ,
  };
};

test('local READY (peer self) never starts remote acquisition', () => {
  assert.equal(
    resolveRemoteSource({
      env: { MOD_S3_PULL_ENABLED: '1', MOD_PEER_PULL_ENABLED: '0' },
      storageMode: 's3',
      manifest: sampleManifest(),
      peerReady: true,
      peerIsSelf: true,
    }),
    'local',
  );
});

test('absent local + s3Key → S3 even if peer READY (peer off)', () => {
  assert.equal(
    resolveRemoteSource({
      env: { MOD_S3_PULL_ENABLED: '1', MOD_PEER_PULL_ENABLED: '0' },
      storageMode: 's3',
      manifest: sampleManifest(),
      peerReady: true,
      peerIsSelf: false,
    }),
    's3',
  );
});

test('no s3Key + peer off → error (no silent peer)', () => {
  assert.equal(
    resolveRemoteSource({
      env: { MOD_S3_PULL_ENABLED: '1', MOD_PEER_PULL_ENABLED: '0' },
      storageMode: 's3',
      manifest: {},
      peerReady: true,
      peerIsSelf: false,
    }),
    'error',
  );
});

test('S3 pull off + peer on + peer READY → peer fallback', () => {
  assert.equal(
    resolveRemoteSource({
      env: { MOD_S3_PULL_ENABLED: '0', MOD_PEER_PULL_ENABLED: '1' },
      storageMode: 's3',
      manifest: sampleManifest(),
      peerReady: true,
      peerIsSelf: false,
    }),
    'peer',
  );
});

test('both pulls off → error', () => {
  assert.equal(
    resolveRemoteSource({
      env: { MOD_S3_PULL_ENABLED: '0', MOD_PEER_PULL_ENABLED: '0' },
      storageMode: 's3',
      manifest: sampleManifest(),
      peerReady: true,
      peerIsSelf: false,
    }),
    'error',
  );
});

test('no peer READY + s3Key → S3', () => {
  assert.equal(
    resolveRemoteSource({
      env: { MOD_S3_PULL_ENABLED: '1', MOD_PEER_PULL_ENABLED: '0' },
      storageMode: 's3',
      manifest: sampleManifest(),
      peerReady: false,
      peerIsSelf: false,
    }),
    's3',
  );
});
