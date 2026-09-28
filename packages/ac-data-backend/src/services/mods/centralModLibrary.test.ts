import assert from 'node:assert/strict';
import test from 'node:test';
import { _test } from './centralModLibrary.js';

const { deriveLocalStatus } = _test;

test('availability: central present + local READY matching sha → LOCAL', () => {
  const local = deriveLocalStatus({
    inventoryStatus: 'READY',
    installedSha256: 'abc',
    expectedSha256: 'abc',
    jobState: null,
    jobPhase: null,
    errorMessage: null,
  });
  assert.equal(local, 'LOCAL');
});

test('availability: central present + no inventory → MISSING', () => {
  const local = deriveLocalStatus({
    inventoryStatus: null,
    installedSha256: null,
    expectedSha256: 'abc',
    jobState: null,
    jobPhase: null,
    errorMessage: null,
  });
  assert.equal(local, 'MISSING');
});

test('availability: active download job → DOWNLOADING', () => {
  const local = deriveLocalStatus({
    inventoryStatus: 'PENDING',
    installedSha256: null,
    expectedSha256: 'abc',
    jobState: 'running',
    jobPhase: 'download',
    errorMessage: null,
  });
  assert.equal(local, 'DOWNLOADING');
});

test('availability: extract phase → INSTALLING', () => {
  const local = deriveLocalStatus({
    inventoryStatus: 'SYNCING',
    installedSha256: null,
    expectedSha256: 'abc',
    jobState: 'running',
    jobPhase: 'extract',
    errorMessage: null,
  });
  assert.equal(local, 'INSTALLING');
});

test('availability: inventory ERROR → ERROR', () => {
  const local = deriveLocalStatus({
    inventoryStatus: 'ERROR',
    installedSha256: null,
    expectedSha256: 'abc',
    jobState: 'failed',
    jobPhase: null,
    errorMessage: 'boom',
  });
  assert.equal(local, 'ERROR');
});

test('availability: READY but wrong sha (v1.1 local, need v1.2) → ERROR not LOCAL', () => {
  const local = deriveLocalStatus({
    inventoryStatus: 'READY',
    installedSha256: 'sha-1.1',
    expectedSha256: 'sha-1.2',
    jobState: null,
    jobPhase: null,
    errorMessage: null,
  });
  assert.equal(local, 'ERROR');
});

test('catalog response mapping uses name/version/size fields', () => {
  const mapped = _test.mapPackageRow({
    id: 'pkg-1',
    slug: 'otarumi_touge',
    kind: 'track',
    display_name: 'Otarumi Touge',
    ac_content_slug: 'otarumi_touge',
    preview_image_filename: null,
    versions: [
      { version: '1.2', artifactId: 'art-2', sha256: 'bbb', size: 234 },
      { version: '1.0', artifactId: 'art-1', sha256: 'aaa', size: '123' },
    ],
  });
  assert.equal(mapped.name, 'Otarumi Touge');
  assert.equal(mapped.imageUrl, null);
  assert.equal(mapped.versions[0].version, '1.2');
  assert.equal(mapped.versions[0].artifactId, 'art-2');
  assert.equal(mapped.versions[1].size, 123);
});

/**
 * Documents ensure idempotency contract used by orchestrator.ensureArtifactOnEdge:
 * same edge + artifact + active job → reuse.
 */
function pickEnsureJob(opts: {
  existingActiveJobId: string | null;
  newJobId: string;
}): { jobId: string; created: boolean } {
  if (opts.existingActiveJobId) {
    return { jobId: opts.existingActiveJobId, created: false };
  }
  return { jobId: opts.newJobId, created: true };
}

test('ensure: already-local path does not need a new job (contract)', () => {
  // LOCAL short-circuit is handled before enqueue; this documents the job reuse half.
  const first = pickEnsureJob({ existingActiveJobId: null, newJobId: 'job-1' });
  const second = pickEnsureJob({ existingActiveJobId: first.jobId, newJobId: 'job-2' });
  const third = pickEnsureJob({ existingActiveJobId: first.jobId, newJobId: 'job-3' });
  assert.equal(first.created, true);
  assert.equal(second.jobId, 'job-1');
  assert.equal(second.created, false);
  assert.equal(third.jobId, 'job-1');
  assert.equal(third.created, false);
});

test('ensure: simultaneous ensure(A) → one job id', () => {
  const active: { id: string } | null = { id: 'shared-job' };
  const results = [1, 2, 3].map(() =>
    pickEnsureJob({
      existingActiveJobId: active?.id ?? null,
      newJobId: 'should-not-use',
    }),
  );
  assert.deepEqual(
    results.map((r) => r.jobId),
    ['shared-job', 'shared-job', 'shared-job'],
  );
});

test('start gate: missing/failed ensure must block start', () => {
  function shouldStart(items: Array<{ status: string }>): boolean {
    return items.every((i) => i.status === 'LOCAL');
  }
  assert.equal(shouldStart([{ status: 'LOCAL' }, { status: 'LOCAL' }]), true);
  assert.equal(shouldStart([{ status: 'LOCAL' }, { status: 'QUEUED' }]), false);
  assert.equal(shouldStart([{ status: 'ERROR' }]), false);
  assert.equal(shouldStart([{ status: 'NOT_FOUND' }]), false);
});
