import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import { contentPoolPath } from './materialize.js';
import { scanLocalModInventory, postModInventoryToHub } from '../modInventoryScan.js';

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
