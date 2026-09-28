import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModAgentJobPayload } from '@projectd/ac-data-shared/mods/types.js';
import {
  acquireModJob,
  agentHeartbeat,
  completeModJob,
  failModJob,
  getArtifactDownloadUrl,
  isModAgentEnabled,
  reportJobProgress,
} from './hubModClient.js';
import { downloadWithResume } from './downloadArtifact.js';
import {
  materializeManifestToPool,
  removeFromPool,
  verifyPoolSlug,
  ensureBlobCached,
  getValidCachedBlob,
} from './materialize.js';

const POLL_MS = Number(process.env.MOD_AGENT_POLL_MS || 1500);
/** How many jobs to drain back-to-back before yielding to the poll interval. */
const DRAIN_MAX = Math.max(1, Number(process.env.MOD_AGENT_DRAIN_MAX || 10));

let tickInFlight = false;

async function diskFreeBytes(): Promise<number | undefined> {
  try {
    const { statfs } = await import('node:fs/promises');
    const stat = await statfs(process.env.AC_MOD_ROOT || '/var/lib/ac-mods');
    return Number(stat.bfree * stat.bsize);
  } catch {
    return undefined;
  }
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
    ...(job.versionLabel ? { version: job.versionLabel } : {}),
    kind: job.manifest.kind,
    slug: acSlug,
  };

  // Cache hit: blob exists + SHA matches → skip download
  let zipPath = await getValidCachedBlob(job.sha256);
  if (zipPath) {
    console.log(`[mod-agent] CACHE HIT sha256=${job.sha256.slice(0, 12)}…`);
    await reportJobProgress(job.jobId, 90, 'cache_hit');
  } else {
    const tmpDir = path.join(os.tmpdir(), 'ac-mod-dl');
    await fsp.mkdir(tmpDir, { recursive: true });
    zipPath = path.join(tmpDir, `${job.sha256}.zip`);

    const signed = await getArtifactDownloadUrl(job.artifactId);
    await downloadWithResume(
      signed.url,
      zipPath,
      job.sizeBytes,
      (pct) => {
        void reportJobProgress(job.jobId, pct, 'download').catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[mod-agent] progress report failed: ${message}`);
        });
      },
      job.sha256,
    );
    await ensureBlobCached(job.sha256, zipPath);
  }

  await reportJobProgress(job.jobId, 95, 'extract');
  await materializeManifestToPool(job.sha256, zipPath, job.manifest, acSlug, sidecarMeta);
  if (zipPath.includes(os.tmpdir())) {
    await fsp.unlink(zipPath).catch(() => undefined);
  }
  await completeModJob(job.jobId, job.sha256);
}

async function tick(): Promise<void> {
  if (tickInFlight) {
    return;
  }
  tickInFlight = true;
  try {
    await agentHeartbeat(await diskFreeBytes());
    // Drain queued jobs immediately instead of waiting POLL_MS between each mod.
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
