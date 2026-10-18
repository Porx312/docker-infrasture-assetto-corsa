import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModAgentJobPayload } from '@projectd/ac-data-shared/mods/types.js';
import { isEdgeFolderStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  acquireModJob,
  agentHeartbeat,
  completeModJob,
  failModJob,
  getArtifactDownloadUrl,
  isModAgentEnabled,
  reportJobProgress,
} from './hubModClient.js';
import { collectHostMetrics } from './hostMetrics.js';
import { downloadWithResume } from './downloadArtifact.js';
import { modPeerSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';
import {
  materializeManifestToPool,
  removeFromPool,
  verifyPoolSlug,
  ensureBlobCached,
  getValidCachedBlob,
  contentPoolPath,
  writeAcModSidecar,
} from './materialize.js';
import { pullAndInstallContentTree, pullAndInstallS3TarGz } from './contentTreeSync.js';

const POLL_MS = Number(process.env.MOD_AGENT_POLL_MS || 1500);
/** How many jobs to drain back-to-back before yielding to the poll interval. */
const DRAIN_MAX = Math.max(1, Number(process.env.MOD_AGENT_DRAIN_MAX || 10));

let tickInFlight = false;

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
    await reportJobProgress(job.jobId, 5, 'tree_download');
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
        void reportJobProgress(job.jobId, pct, 'tree_download').catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[mod-agent] progress report failed: ${message}`);
        });
      },
    );
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
    await reportJobProgress(job.jobId, 5, 's3_download');
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
        void reportJobProgress(job.jobId, pct, 's3_download').catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[mod-agent] progress report failed: ${message}`);
        });
      },
    );
    await completeModJob(job.jobId, result.contentHash);
    return;
  }

  // Legacy ZIP blob path (hub master or edge blob cache)
  let zipPath = await getValidCachedBlob(job.sha256);
  if (zipPath) {
    console.log(`[mod-agent] CACHE HIT sha256=${job.sha256.slice(0, 12)}…`);
    await reportJobProgress(job.jobId, 90, 'cache_hit');
  } else {
    const tmpDir = path.join(os.tmpdir(), 'ac-mod-dl');
    await fsp.mkdir(tmpDir, { recursive: true });
    zipPath = path.join(tmpDir, `${job.sha256}.zip`);

    const secret = modPeerSecret();
    const downloadHeaders = secret ? { 'X-Worker-Secret': secret } : undefined;
    const url =
      typeof job.downloadUrl === 'string' && job.downloadUrl.trim()
        ? job.downloadUrl.trim()
        : (await getArtifactDownloadUrl(job.artifactId)).url;
    await downloadWithResume(
      url,
      zipPath,
      job.sizeBytes,
      (pct) => {
        void reportJobProgress(job.jobId, pct, 'download').catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[mod-agent] progress report failed: ${message}`);
        });
      },
      job.sha256,
      downloadHeaders,
    );
    // Ephemeral only: do not keep permanent blob cache for new installs from temp.
    // Legacy peer blob pulls may still land in cache via ensureBlobCached when source is ZIP.
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
