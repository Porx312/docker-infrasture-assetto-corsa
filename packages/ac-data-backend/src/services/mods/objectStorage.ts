import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolveModMasterLocalPath, resolveModUploadRoot } from './modPaths.js';

export type ObjectStorageMode = 'local' | 's3';

function storageMode(): ObjectStorageMode {
  const raw = (process.env.MOD_STORAGE_MODE || 'local').trim().toLowerCase();
  return raw === 's3' ? 's3' : 'local';
}

function localMasterRoot(): string {
  return resolveModMasterLocalPath(resolveModUploadRoot());
}

function s3Config(): {
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

export function artifactStorageKey(sha256: string): string {
  const prefix = sha256.slice(0, 2);
  const mid = sha256.slice(2, 4);
  return `artifacts/sha256/${prefix}/${mid}/${sha256}.zip`;
}

export async function putArtifactFromFile(localPath: string, sha256: string): Promise<string> {
  const key = artifactStorageKey(sha256);
  if (storageMode() === 'local') {
    const dest = path.join(localMasterRoot(), key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(localPath, dest);
    return key;
  }
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const cfg = s3Config();
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: Boolean(cfg.endpoint),
  });
  const body = fs.createReadStream(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/zip',
    }),
  );
  return key;
}

export async function getArtifactDownloadUrl(
  storageKey: string,
  sha256: string,
  _sizeBytes: number,
): Promise<{ url: string; expiresInSec: number }> {
  const expiresInSec = Number(process.env.MOD_PRESIGN_TTL_SEC || 3600);
  if (storageMode() === 'local') {
    const hubBase = (process.env.MOD_HUB_PUBLIC_URL || process.env.HUD_PUBLIC_BASE_URL || '').trim();
    if (!hubBase) {
      throw new Error('MOD_HUB_PUBLIC_URL required for local artifact downloads');
    }
    const token = sha256.slice(0, 16);
    const url = `${hubBase.replace(/\/+$/, '')}/api/mods/internal/artifacts/download?key=${encodeURIComponent(storageKey)}&sha256=${sha256}&token=${token}`;
    return { url, expiresInSec };
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const cfg = s3Config();
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: Boolean(cfg.endpoint),
  });
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

export async function streamLocalMasterArtifact(
  storageKey: string,
  res: import('express').Response,
): Promise<void> {
  const filePath = path.join(localMasterRoot(), storageKey);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, error: 'not_found' });
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
  const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const cfg = s3Config();
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: Boolean(cfg.endpoint),
  });
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: storageKey }));
}
