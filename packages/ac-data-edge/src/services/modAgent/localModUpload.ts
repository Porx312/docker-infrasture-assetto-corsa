import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import { getValidCachedBlob, contentPoolPath } from './materialize.js';
import { scanLocalModInventory, postModInventoryToHub } from '../modInventoryScan.js';

/** Stream legacy content-addressed blob for peer copy (deprecated for new artifacts). */
export async function handleServeModBlob(req: Request, res: Response): Promise<void> {
  const sha256 = String(req.params.sha256 || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    res.status(400).json({ ok: false, error: 'invalid_sha256' });
    return;
  }
  const zipPath = await getValidCachedBlob(sha256);
  if (!zipPath) {
    res.status(404).json({ ok: false, error: 'blob_not_found' });
    return;
  }
  const stat = fs.statSync(zipPath);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Content-Sha256', sha256);
  fs.createReadStream(zipPath).pipe(res);
}

/** Delete a car/track folder from this edge CONTENT_PATH pool (orphans without catalog OK). */
export async function handleDeleteLocalContent(req: Request, res: Response): Promise<void> {
  const kindRaw = String(req.params.kind || '').trim().toLowerCase();
  const slug = String(req.params.slug || '').trim();
  if ((kindRaw !== 'car' && kindRaw !== 'track') || !slug || slug.includes('..') || slug.includes('/')) {
    res.status(400).json({ ok: false, message: 'kind (car|track) and slug required' });
    return;
  }
  const folder = kindRaw === 'car' ? 'cars' : 'tracks';
  const destDir = path.join(contentPoolPath(), folder, slug);
  if (!fs.existsSync(destDir)) {
    res.status(404).json({ ok: false, message: 'content_not_found' });
    return;
  }
  try {
    await fsp.rm(destDir, { recursive: true, force: true });
    void scanLocalModInventory()
      .then((snap) => postModInventoryToHub(snap))
      .catch(() => undefined);
    res.json({ ok: true, message: `Removed ${folder}/${slug} from this VPS` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message });
  }
}
