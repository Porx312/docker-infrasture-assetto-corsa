import fs from 'fs';
import type { Response } from 'express';

/** Prevent 304 responses — launcher clients must always receive the ZIP body. */
export function setZipDownloadNoCacheHeaders(
  res: Response,
  filename: string,
  contentLength?: number,
): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (contentLength !== undefined) {
    res.setHeader('Content-Length', String(contentLength));
  }
}

export async function sendZipDownloadFile(res: Response, filePath: string): Promise<void> {
  const stats = await fs.promises.stat(filePath);
  if (!res.getHeader('Content-Length')) {
    res.setHeader('Content-Length', String(stats.size));
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      if (!res.headersSent) {
        reject(err);
        return;
      }
      res.destroy(err);
    });
    stream.on('end', () => resolve());
    res.on('error', reject);
    stream.pipe(res);
  });
}
