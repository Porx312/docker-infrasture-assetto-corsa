import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256String(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function fileSizeBytes(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}
