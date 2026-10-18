import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolveModMasterLocalPath, resolveModUploadRoot } from './modPaths.js';
import { artifactTarGzStorageKey } from '@projectd/ac-data-shared/mods/modS3Manifest.js';

export type ObjectStorageMode = 'local' | 's3';

export function storageMode(): ObjectStorageMode {
  const raw = (process.env.MOD_STORAGE_MODE || 'local').trim().toLowerCase();
  return raw === 's3' ? 's3' : 'local';
}

function localMasterRoot(): string {
  return resolveModMasterLocalPath(resolveModUploadRoot());
}

export function s3Config(): {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
} {
  const bucket = (process.env.MOD_S3_BUCKET || '').trim();
  const accessKeyId = (process.env.MOD_S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.MOD_S3_SECRET_ACCESS_KEY || '').trim();
  const region = (process.env.MOD_S3_REGION || 'auto').trim();
  const endpoint = (process.env.MOD_S3_ENDPOINT || '').trim() || undefined;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('MOD_S3_BUCKET and credentials required for MOD_STORAGE_MODE=s3');
  }
  return { bucket, region, endpoint, accessKeyId, secretAccessKey };
}

export async function createS3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const cfg = s3Config();
  return {
    client: new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: Boolean(cfg.endpoint),
    }),
    cfg,
  };
}

/** Legacy hub ZIP key layout (unused for new edge_folder promotes). */
export function artifactStorageKey(sha256: string): string {
  const prefix = sha256.slice(0, 2);
  const mid = sha256.slice(2, 4);
  return `artifacts/sha256/${prefix}/${mid}/${sha256}.zip`;
}

export { artifactTarGzStorageKey };

/** Presign GET for hub master ZIP or canonical tar.gz keys. */
export async function getArtifactDownloadUrl(
  storageKey: string,
  sha256: string,
  _sizeBytes: number,
): Promise<{ url: string; expiresInSec: number }> {
  const expiresInSec = Number(process.env.MOD_PRESIGN_TTL_SEC || 3600);
  if (storageMode() === 'local') {
    const hubBase = (
      process.env.HUD_PUBLIC_BASE_URL ||
      process.env.PUBLIC_API_BASE_URL ||
      ''
    ).trim();
    if (!hubBase) {
      throw new Error(
        'HUD_PUBLIC_BASE_URL required for leftover hub master downloads (prefer edge_folder / adopt)',
      );
    }
    const token = sha256.slice(0, 16);
    const url = `${hubBase.replace(/\/+$/, '')}/api/mods/internal/artifacts/download?key=${encodeURIComponent(storageKey)}&sha256=${sha256}&token=${token}`;
    return { url, expiresInSec };
  }
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const { client, cfg } = await createS3Client();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: storageKey,
    }),
    { expiresIn: expiresInSec },
  );
  return { url, expiresInSec };
}

export type PutCanonicalResult =
  | { status: 'uploaded'; key: string }
  | { status: 'already_exists'; key: string }
  | { status: 'skipped_not_s3_mode' };

/**
 * Upload canonical server-slim tar.gz. Uses If-None-Match: * so concurrent puts
 * do not overwrite; 412 → treat as already_exists (caller must verify object).
 */
export async function putCanonicalTarGz(input: {
  key: string;
  filePath: string;
  contentHash: string;
  objectSha256: string;
  sizeBytes: number;
}): Promise<PutCanonicalResult> {
  if (storageMode() !== 's3') {
    return { status: 'skipped_not_s3_mode' };
  }
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { client, cfg } = await createS3Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: input.key,
        Body: createReadStream(input.filePath),
        ContentType: 'application/gzip',
        ContentLength: input.sizeBytes,
        IfNoneMatch: '*',
        Metadata: {
          'content-hash': input.contentHash.toLowerCase(),
          'object-sha256': input.objectSha256.toLowerCase(),
        },
      }),
    );
    return { status: 'uploaded', key: input.key };
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? String((err as { name: unknown }).name)
        : '';
    const httpStatus =
      err && typeof err === 'object' && '$metadata' in err
        ? Number(
            (err as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode,
          )
        : 0;
    // Contabo/Ceph may surface PreconditionFailed / 412 when object exists.
    if (name === 'PreconditionFailed' || httpStatus === 412) {
      return { status: 'already_exists', key: input.key };
    }
    throw err;
  }
}

export async function headCanonicalObject(key: string): Promise<{
  exists: boolean;
  contentLength?: number;
  metadata?: Record<string, string>;
}> {
  if (storageMode() !== 's3') {
    return { exists: false };
  }
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const { client, cfg } = await createS3Client();
  try {
    const out = await client.send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    return {
      exists: true,
      contentLength: out.ContentLength,
      metadata: out.Metadata as Record<string, string> | undefined,
    };
  } catch (err: unknown) {
    const httpStatus =
      err && typeof err === 'object' && '$metadata' in err
        ? Number(
            (err as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode,
          )
        : 0;
    if (httpStatus === 404 || (err as { name?: string })?.name === 'NotFound') {
      return { exists: false };
    }
    throw err;
  }
}

/** Absolute path for a local master blob (MOD_STORAGE_MODE=local). */
export function localMasterArtifactPath(storageKey: string): string {
  return path.join(localMasterRoot(), storageKey);
}

/** True when local master ZIP exists on disk. Always true for s3 mode (remote). */
export function localMasterArtifactExists(storageKey: string): boolean {
  if (storageMode() !== 'local') {
    return true;
  }
  return fs.existsSync(localMasterArtifactPath(storageKey));
}

export async function streamLocalMasterArtifact(
  storageKey: string,
  res: import('express').Response,
): Promise<void> {
  const filePath = localMasterArtifactPath(storageKey);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({
      ok: false,
      error: 'artifact_blob_missing',
      message: 'Leftover hub master ZIP missing — re-adopt/upload on an edge (folder-first)',
    });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Accept-Ranges', 'bytes');
  const stat = await fsp.stat(filePath);
  const range = res.req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  res.setHeader('Content-Length', String(stat.size));
  await pipeline(createReadStream(filePath), res);
}

export async function deleteMasterArtifact(storageKey: string): Promise<void> {
  if (storageMode() === 'local') {
    const filePath = path.join(localMasterRoot(), storageKey);
    await fsp.unlink(filePath).catch(() => undefined);
    return;
  }
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const { client, cfg } = await createS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: storageKey }));
}

/** Delete a Contabo/S3 object by key (library tar.gz). */
export async function deleteCanonicalObject(key: string): Promise<void> {
  if (storageMode() !== 's3') return;
  const k = key.trim();
  if (!k) return;
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const { client, cfg } = await createS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: k }));
}

/** List object keys under artifacts/ (ops / library inventory). */
export async function listCanonicalArtifactKeys(maxKeys = 500): Promise<
  Array<{ key: string; size: number; lastModified?: string }>
> {
  if (storageMode() !== 's3') return [];
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const { client, cfg } = await createS3Client();
  const out: Array<{ key: string; size: number; lastModified?: string }> = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: 'artifacts/',
        ContinuationToken: token,
        MaxKeys: Math.min(1000, maxKeys - out.length),
      }),
    );
    for (const obj of page.Contents || []) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        size: Number(obj.Size || 0),
        lastModified: obj.LastModified?.toISOString(),
      });
      if (out.length >= maxKeys) return out;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}
