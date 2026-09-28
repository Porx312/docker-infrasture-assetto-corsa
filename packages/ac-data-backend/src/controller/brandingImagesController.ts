import type { Request, Response } from 'express';
import fs from 'node:fs';
import {
  brandingImageContentType,
  ensureBrandingImagesDir,
  resolveSafeBrandingImagePath,
} from '../services/brandingImages.js';

/** Public CM/player fetch — no admin auth. */
export async function getPublicBrandingImageHandler(req: Request, res: Response): Promise<void> {
  const filename = typeof req.params.filename === 'string' ? req.params.filename : '';
  const fullPath = resolveSafeBrandingImagePath(filename);
  if (!fullPath) {
    res.status(400).json({ ok: false, error: 'invalid_filename' });
    return;
  }

  try {
    await ensureBrandingImagesDir();
  } catch {
    /* dir may still exist */
  }

  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }

  res.setHeader('Content-Type', brandingImageContentType(filename));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(fullPath);
}
