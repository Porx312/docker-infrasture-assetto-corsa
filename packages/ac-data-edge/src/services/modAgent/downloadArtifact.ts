import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  createProgressThrottleState,
  shouldEmitProgress,
} from './progressThrottle.js';

function downloadTimeoutMs(): number {
  const raw = Number(process.env.MOD_S3_PULL_TIMEOUT_MS || process.env.MOD_DOWNLOAD_TIMEOUT_MS || 600_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}

export async function downloadWithResume(
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress: (pct: number) => void,
  expectedSha256: string,
  extraHeaders?: Record<string, string>,
): Promise<{ downloadMs: number; hashMs: number }> {
  const partPath = `${destPath}.part`;
  let start = 0;
  try {
    const stat = await fsp.stat(partPath);
    start = stat.size;
  } catch {
    start = 0;
  }

  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  if (start > 0 && start < expectedSize) {
    headers.Range = `bytes=${start}-`;
  } else if (start >= expectedSize) {
    start = 0;
    await fsp.unlink(partPath).catch(() => undefined);
  }

  const t0 = Date.now();
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(downloadTimeoutMs()),
  });
  if (res.status !== 200 && res.status !== 206) {
    const hint =
      res.status === 404 || res.status === 409
        ? ' (hub missing blob or wrong MOD_HUB_PUBLIC_URL / peer edge)'
        : '';
    throw new Error(`Download failed: HTTP ${res.status}${hint}`);
  }

  const writeFlags = start > 0 && res.status === 206 ? 'a' : 'w';
  if (writeFlags === 'w') {
    start = 0;
  }
  await fsp.mkdir(path.dirname(partPath), { recursive: true });
  const fileStream = createWriteStream(partPath, { flags: writeFlags });
  const reader = res.body;
  if (!reader) {
    throw new Error('Empty response body');
  }

  let received = start;
  const total = expectedSize > 0 ? expectedSize : 1;
  const progressGate = createProgressThrottleState();
  for await (const chunk of reader as AsyncIterable<Uint8Array>) {
    fileStream.write(chunk);
    received += chunk.length;
    const pct = Math.min(99, Math.round((received / total) * 100));
    if (shouldEmitProgress(progressGate, pct, Date.now(), 500)) {
      onProgress(pct);
    }
  }
  await new Promise<void>((resolve, reject) => {
    fileStream.end(() => resolve());
    fileStream.on('error', reject);
  });
  const downloadMs = Date.now() - t0;

  const tHash = Date.now();
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(partPath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const digest = hash.digest('hex');
  if (digest !== expectedSha256) {
    await fsp.unlink(partPath).catch(() => undefined);
    throw new Error('SHA-256 mismatch after download');
  }
  const hashMs = Date.now() - tHash;

  await fsp.rename(partPath, destPath);
  return { downloadMs, hashMs };
}
