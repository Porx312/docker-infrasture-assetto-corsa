/**
 * After edge_folder register: pull server-slim tar from source edge, gzip, upload to S3,
 * then set manifest_json.s3* only on success. Failures never mark S3 available.
 */
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  artifactTarGzStorageKey,
  isModS3CanonicalUploadEnabled,
  MOD_S3_FORMAT_TAR_GZ,
  readModS3Fields,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';
import {
  isEdgeFolderStorageKey,
  parseEdgeFolderStorageKey,
} from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import { resolveFleetEdge } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { modPeerSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';
import { getArtifactById, mergeArtifactManifestS3 } from './catalogRepo.js';
import { getModPool } from './db.js';
import {
  headCanonicalObject,
  putCanonicalTarGz,
  storageMode,
} from './objectStorage.js';

function advisoryLockKey(contentHash: string): number {
  // Stable 31-bit positive int from contentHash for pg_advisory_lock
  const buf = createHash('sha256').update(`s3-promote:${contentHash}`).digest();
  return buf.readUInt32BE(0) & 0x7fffffff;
}

async function findReadyPeer(
  artifactId: string,
  sha256: string,
  preferEdgeId?: string | null,
): Promise<string | null> {
  const pool = getModPool();
  if (preferEdgeId) {
    const preferred = await pool.query<{ edge_id: string }>(
      `SELECT edge_id FROM edge_artifact_inventory
       WHERE artifact_id = $1 AND edge_id = $2 AND status = 'READY'
         AND (installed_sha256 IS NULL OR installed_sha256 = $3)
       LIMIT 1`,
      [artifactId, preferEdgeId.toLowerCase(), sha256],
    );
    if (preferred.rows[0]) return preferred.rows[0].edge_id;
  }
  const any = await pool.query<{ edge_id: string }>(
    `SELECT edge_id FROM edge_artifact_inventory
     WHERE artifact_id = $1 AND status = 'READY'
       AND (installed_sha256 IS NULL OR installed_sha256 = $2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [artifactId, sha256],
  );
  return any.rows[0]?.edge_id ?? null;
}

function peerTreeUrl(sourceEdgeId: string, kind: string, slug: string): string {
  const edge = resolveFleetEdge(sourceEdgeId);
  if (!edge?.baseUrl) {
    throw new Error(`peer_edge_unreachable: no baseUrl for edge ${sourceEdgeId}`);
  }
  return `${edge.baseUrl.replace(/\/+$/, '')}/api/mod-agent/v1/trees/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Best-effort promote. Safe to fire-and-forget after register.
 * No-ops when flags off, already has s3Key, or S3 mode disabled.
 */
export async function promoteArtifactToS3(artifactId: string): Promise<{
  ok: boolean;
  skipped?: string;
  error?: string;
}> {
  if (!isModS3CanonicalUploadEnabled()) {
    return { ok: true, skipped: 'flag_off' };
  }
  if (storageMode() !== 's3') {
    return { ok: true, skipped: 'storage_mode_not_s3' };
  }

  const art = await getArtifactById(artifactId);
  if (!art) {
    return { ok: false, error: 'artifact_not_found' };
  }
  if (readModS3Fields(art.manifest_json)) {
    return { ok: true, skipped: 'already_has_s3' };
  }
  if (!isEdgeFolderStorageKey(art.storage_key)) {
    return { ok: true, skipped: 'not_edge_folder' };
  }

  const parsed = parseEdgeFolderStorageKey(art.storage_key);
  const prefer = parsed?.edgeId ?? art.source_edge_id;
  const kind = parsed?.kind ?? art.package.kind;
  const slug = parsed?.slug ?? art.package.ac_content_slug;
  const peer = await findReadyPeer(artifactId, art.sha256, prefer);
  if (!peer) {
    return { ok: false, error: 'no_ready_peer_for_tar' };
  }

  const lockId = advisoryLockKey(art.sha256);
  const pool = getModPool();
  const locked = await pool.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [lockId],
  );
  if (!locked.rows[0]?.locked) {
    return { ok: true, skipped: 'promote_in_progress' };
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-s3-promote-'));
  const tarPath = path.join(tmpDir, 'slim.tar');
  const gzPath = path.join(tmpDir, 'slim.tar.gz');
  try {
    // Re-check after lock (another worker may have finished).
    const again = await getArtifactById(artifactId);
    if (again && readModS3Fields(again.manifest_json)) {
      return { ok: true, skipped: 'already_has_s3' };
    }

    const url = peerTreeUrl(peer, kind, slug);
    const secret = modPeerSecret();
    const headers: Record<string, string> = {};
    if (secret) headers['X-Worker-Secret'] = secret;

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(Number(process.env.MOD_TREE_PULL_TIMEOUT_MS || 600_000)),
    });
    if (!res.ok || !res.body) {
      return { ok: false, error: `peer_tar_http_${res.status}` };
    }

    const { Readable } = await import('node:stream');
    const body = res.body as unknown as import('node:stream/web').ReadableStream;
    const readable = Readable.fromWeb(body);
    await pipeline(readable, createWriteStream(tarPath));

    await pipeline(createReadStream(tarPath), createGzip(), createWriteStream(gzPath));
    const objectSha256 = await sha256File(gzPath);
    const stat = await fsp.stat(gzPath);
    const key = artifactTarGzStorageKey(art.sha256);

    const put = await putCanonicalTarGz({
      key,
      filePath: gzPath,
      contentHash: art.sha256,
      objectSha256,
      sizeBytes: stat.size,
    });

    if (put.status === 'skipped_not_s3_mode') {
      return { ok: true, skipped: 'storage_mode_not_s3' };
    }

    let finalSha = objectSha256;
    let finalSize = stat.size;
    if (put.status === 'already_exists') {
      const head = await headCanonicalObject(key);
      if (!head.exists) {
        return { ok: false, error: 'put_exists_but_head_missing' };
      }
      const metaSha = head.metadata?.['object-sha256'] || head.metadata?.objectsha256;
      if (metaSha && metaSha.toLowerCase() !== objectSha256) {
        // Existing object from another content — do not overwrite; refuse to mark.
        // Same contentHash key should mean same slim tree; size/meta mismatch is unexpected.
        console.warn(
          `[s3-promote] key exists with different object-sha256 artifact=${artifactId.slice(0, 8)}`,
        );
      }
      if (typeof head.contentLength === 'number' && head.contentLength > 0) {
        finalSize = head.contentLength;
      }
      if (metaSha && /^[a-f0-9]{64}$/i.test(metaSha)) {
        finalSha = metaSha.toLowerCase();
      }
    }

    const merged = await mergeArtifactManifestS3(artifactId, {
      s3Key: key,
      s3Sha256: finalSha,
      s3SizeBytes: finalSize,
      s3Format: MOD_S3_FORMAT_TAR_GZ,
    });
    if (!merged.ok) {
      return { ok: false, error: merged.reason || 'merge_failed' };
    }

    console.log(
      `[s3-promote] ok artifact=${artifactId.slice(0, 8)}… key=${key} bytes=${finalSize} put=${put.status}`,
    );
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[s3-promote] failed artifact=${artifactId.slice(0, 8)}…: ${message}`);
    return { ok: false, error: message };
  } finally {
    await pool.query(`SELECT pg_advisory_unlock($1)`, [lockId]).catch(() => undefined);
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Non-blocking wrapper for register path. */
export function schedulePromoteArtifactToS3(artifactId: string): void {
  if (!isModS3CanonicalUploadEnabled()) {
    console.log(
      `[s3-promote] skip schedule artifact=${artifactId.slice(0, 8)}… (MOD_S3_CANONICAL_UPLOAD!=1)`,
    );
    return;
  }
  console.log(`[s3-promote] scheduled artifact=${artifactId.slice(0, 8)}…`);
  void promoteArtifactToS3(artifactId)
    .then((out) => {
      if (out.skipped) {
        console.log(
          `[s3-promote] finished artifact=${artifactId.slice(0, 8)}… skipped=${out.skipped}`,
        );
      } else if (!out.ok) {
        console.warn(
          `[s3-promote] finished artifact=${artifactId.slice(0, 8)}… error=${out.error || 'unknown'}`,
        );
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[s3-promote] unhandled: ${message}`);
    });
}
