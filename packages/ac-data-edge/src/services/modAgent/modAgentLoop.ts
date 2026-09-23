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
} from './materialize.js';

const POLL_MS = Number(process.env.MOD_AGENT_POLL_MS || 5000);

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

  const tmpDir = path.join(os.tmpdir(), 'ac-mod-dl');
  await fsp.mkdir(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, `${job.sha256}.zip`);

  const signed = await getArtifactDownloadUrl(job.artifactId);
  await downloadWithResume(
    signed.url,
    zipPath,
    job.sizeBytes,
    (pct) => {
      void reportJobProgress(job.jobId, pct, 'download');
    },
    job.sha256,
  );

  await reportJobProgress(job.jobId, 95, 'extract');
  await ensureBlobCached(job.sha256, zipPath);
  await materializeManifestToPool(job.sha256, zipPath, job.manifest, acSlug);
  await fsp.unlink(zipPath).catch(() => undefined);
  await completeModJob(job.jobId, job.sha256);
}

async function tick(): Promise<void> {
  await agentHeartbeat(await diskFreeBytes());
  const job = await acquireModJob(`agent-${process.pid}`);
  if (!job) {
    return;
  }
  try {
    await processJob(job);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await failModJob(job.jobId, 'agent_error', message, true);
  }
}

export function startModAgentLoop(): void {
  if (!isModAgentEnabled()) {
    console.log('[mod-agent] disabled (set MOD_AGENT_ENABLED=true)');
    return;
  }
  console.log('[mod-agent] started');
  const run = () => {
    void tick().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mod-agent] tick error: ${message}`);
    });
  };
  run();
  setInterval(run, POLL_MS);
}
