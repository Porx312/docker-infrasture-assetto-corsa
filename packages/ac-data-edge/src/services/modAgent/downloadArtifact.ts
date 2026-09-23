import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export async function downloadWithResume(
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress: (pct: number) => void,
  expectedSha256: string,
): Promise<void> {
  const partPath = `${destPath}.part`;
  let start = 0;
  try {
    const stat = await fsp.stat(partPath);
    start = stat.size;
  } catch {
    start = 0;
  }

  const headers: Record<string, string> = {};
  if (start > 0 && start < expectedSize) {
    headers.Range = `bytes=${start}-`;
  } else if (start >= expectedSize) {
    start = 0;
    await fsp.unlink(partPath).catch(() => undefined);
  }

  const res = await fetch(url, { headers });
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(`Download failed: HTTP ${res.status}`);
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
  const total = expectedSize;
  for await (const chunk of reader as AsyncIterable<Uint8Array>) {
    fileStream.write(chunk);
    received += chunk.length;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  await new Promise<void>((resolve, reject) => {
    fileStream.end(() => resolve());
    fileStream.on('error', reject);
  });

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

  await fsp.rename(partPath, destPath);
}
