import type { Request, Response } from 'express';
import fs from 'node:fs';
import {
  ensureModPreviewImagesDir,
  modPreviewImageContentType,
  resolveSafeModPreviewImagePath,
} from '../services/mods/modPreviewImages.js';

/** Public Host/CDN fetch — no admin auth. */
export async function getPublicModPreviewImageHandler(req: Request, res: Response): Promise<void> {
  const filename = typeof req.params.filename === 'string' ? req.params.filename : '';
  const fullPath = resolveSafeModPreviewImagePath(filename);
  if (!fullPath) {
    res.status(400).json({ ok: false, error: 'invalid_filename' });
    return;
  }

  try {
    await ensureModPreviewImagesDir();
  } catch {
    /* dir may still exist */
  }

  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }

  res.setHeader('Content-Type', modPreviewImageContentType(filename));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(fullPath);
}
