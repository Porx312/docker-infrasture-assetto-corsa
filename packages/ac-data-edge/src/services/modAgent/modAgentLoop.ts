import path from 'node:path';
import type { ModAgentJobPayload } from '@projectd/ac-data-shared/mods/types.js';
import { isEdgeFolderStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  acquireModJob,
  agentHeartbeat,
  completeModJob,
  failModJob,
  isModAgentEnabled,
  reportJobProgress,
} from './hubModClient.js';
import { collectHostMetrics } from './hostMetrics.js';
import { modPeerSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';
import {
  removeFromPool,
  verifyPoolSlug,
  contentPoolPath,
  writeAcModSidecar,
} from './materialize.js';
import { pullAndInstallContentTree, pullAndInstallS3TarGz } from './contentTreeSync.js';
import {
  createProgressThrottleState,
  shouldEmitProgress,
} from './progressThrottle.js';
import { notifyContentReadyForConfigApplier } from '../redisConfigApplier.js';

const POLL_MS = Number(process.env.MOD_AGENT_POLL_MS || 1500);
/** How many jobs to drain back-to-back before yielding to the poll interval. */
const DRAIN_MAX = Math.max(1, Number(process.env.MOD_AGENT_DRAIN_MAX || 10));
/** Min ms between identical/% progress POSTs (also emit on each integer % change). */
const PROGRESS_MIN_MS = Math.max(0, Number(process.env.MOD_AGENT_PROGRESS_MIN_MS || 500));

let tickInFlight = false;

/**
 * Serialize progress HTTP so reports cannot race past completeModJob.
 * Throttles: only enqueue when integer % changes or every PROGRESS_MIN_MS.
 */
export function createProgressReporter(
  jobId: string,
  phase: string,
): (pct: number) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  const throttle = createProgressThrottleState();
  return (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (!shouldEmitProgress(throttle, clamped, Date.now(), PROGRESS_MIN_MS, clamped >= 100)) {
      return chain;
    }
    chain = chain
      .then(() => reportJobProgress(jobId, clamped, phase))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mod-agent] progress report failed: ${message}`);
      });
    return chain;
  };
}

async function processJob(job: ModAgentJobPayload): Promise<void> {
  const acSlug =
    job.acContentSlug || job.manifest.acContentSlugs[0] || job.manifest.rootPaths[0] || 'unknown';

  if (job.operation === 'remove') {
    await reportJobProgress(job.jobId, 50, 'remove');
    await removeFromPool(job.manifest, acSlug);
    await completeModJob(job.jobId, job.sha256);
    return;
  }

  if (job.operation === 'verify') {
    const ok = await verifyPoolSlug(job.manifest, acSlug);
    if (!ok) {
      await failModJob(job.jobId, 'verify_failed', 'Content missing in pool', true);
      return;
    }
    await completeModJob(job.jobId, job.sha256);
    return;
  }

  const sidecarMeta = {
    artifactId: job.artifactId,
    sha256: job.sha256,
    contentHash: job.sha256,
    ...(job.versionLabel ? { version: job.versionLabel } : {}),
    kind: job.manifest.kind,
    slug: acSlug,
  };

  const treeUrl =
    typeof job.treeDownloadUrl === 'string' && job.treeDownloadUrl.trim()
      ? job.treeDownloadUrl.trim()
      : '';
  const s3Url =
    typeof job.s3DownloadUrl === 'string' && job.s3DownloadUrl.trim()
      ? job.s3DownloadUrl.trim()
      : '';

  // Folder already on this edge (peer === self, no remote URL): verify pool, refresh sidecar.
  if (!treeUrl && !s3Url && isEdgeFolderStorageKey(job.storageKey)) {
    const ok = await verifyPoolSlug(job.manifest, acSlug);
    if (!ok) {
      await failModJob(job.jobId, 'folder_missing', 'Content folder missing on this VPS', true);
      return;
    }
    const folder = job.manifest.contentTypeFolder;
    if (folder) {
      await writeAcModSidecar(path.join(contentPoolPath(), folder, acSlug), sidecarMeta).catch(
        () => undefined,
      );
    }
    await completeModJob(job.jobId, job.sha256);
    return;
  }

  if (treeUrl) {
    const secret = modPeerSecret();
    const downloadHeaders = secret ? { 'X-Worker-Secret': secret } : undefined;
    const reportProgress = createProgressReporter(job.jobId, 'tree_download');
    await reportProgress(5);
    const result = await pullAndInstallContentTree(
      treeUrl,
      job.manifest.kind,
      acSlug,
      downloadHeaders,
      {
        artifactId: job.artifactId,
        contentHash: job.sha256,
        versionLabel: job.versionLabel,
      },
      (pct) => {
        void reportProgress(pct);
      },
    );
    await reportProgress(100);
    await completeModJob(job.jobId, result.contentHash);
    return;
  }

  if (s3Url) {
    const objectSha =
      typeof job.s3ObjectSha256 === 'string' ? job.s3ObjectSha256.trim().toLowerCase() : '';
    const objectSize = Number(job.s3ObjectSizeBytes);
    if (!/^[a-f0-9]{64}$/.test(objectSha) || !Number.isFinite(objectSize) || objectSize <= 0) {
      await failModJob(job.jobId, 's3_meta_invalid', 'Missing validated s3 object hash/size', false);
      return;
    }
    const reportProgress = createProgressReporter(job.jobId, 's3_download');
    await reportProgress(5);
    const result = await pullAndInstallS3TarGz(
      s3Url,
      job.manifest.kind,
      acSlug,
      objectSha,
      objectSize,
      {
        artifactId: job.artifactId,
        contentHash: job.sha256,
        versionLabel: job.versionLabel,
      },
      (pct) => {
        void reportProgress(pct);
      },
    );
    await reportProgress(100);
    await completeModJob(job.jobId, result.contentHash);
    return;
  }

  await failModJob(
    job.jobId,
    'unsupported_source',
    'No s3DownloadUrl or treeDownloadUrl — ZIP/hub-master install removed; re-upload to S3 library or enable peer tree',
    false,
  );
}

async function tick(): Promise<void> {
  if (tickInFlight) {
    return;
  }
  tickInFlight = true;
  try {
    await agentHeartbeat(await collectHostMetrics());
    for (let i = 0; i < DRAIN_MAX; i += 1) {
      const job = await acquireModJob(`agent-${process.pid}`);
      if (!job) {
        return;
      }
      const started = Date.now();
      try {
        await processJob(job);
        console.log(
          `[mod-agent] job ${job.jobId.slice(0, 8)}… ${job.operation} ok in ${Date.now() - started}ms`,
        );
        const slug =
          job.acContentSlug || job.manifest.acContentSlugs[0] || job.manifest.rootPaths[0] || '';
        if (slug && job.operation !== 'remove') {
          notifyContentReadyForConfigApplier([slug]);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[mod-agent] job ${job.jobId.slice(0, 8)}… failed: ${message}`);
        try {
          await failModJob(job.jobId, 'agent_error', message, true);
        } catch (failErr: unknown) {
          const failMessage = failErr instanceof Error ? failErr.message : String(failErr);
          console.error(`[mod-agent] failJob HTTP failed after error: ${failMessage}`);
        }
      }
    }
  } finally {
    tickInFlight = false;
  }
}

export function startModAgentLoop(): void {
  if (!isModAgentEnabled()) {
    console.log('[mod-agent] disabled (set MOD_AGENT_ENABLED=true)');
    return;
  }
  console.log(`[mod-agent] started pollMs=${POLL_MS} drainMax=${DRAIN_MAX}`);
  const run = () => {
    void tick().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mod-agent] tick error: ${message}`);
    });
  };
  run();
  setInterval(run, POLL_MS);
}
