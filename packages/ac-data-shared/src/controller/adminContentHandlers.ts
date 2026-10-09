import type { Request, Response } from 'express';
import fs from 'fs';
import {
  listContent,
  deleteContent,
  uploadSingleFile,
  extractZip,
  getContentSummary,
  type ContentType,
} from '../services/contentManager.js';
import {
  listContentVariants,
  previewContentType,
  resolveVariantPreviewPath,
} from '../services/contentPreviews.js';
import {
  deleteHudRelease,
  listHudReleases,
  resolveHudReleasePath,
  uploadHudRelease,
} from '../services/projectdHudManager.js';
import { deleteEmptyContent, parseSyncContentType } from '../services/contentAdminHelpers.js';

export async function getContent(_req: Request, res: Response): Promise<void> {
  try {
    const summary = await getContentSummary();
    res.json({ ok: true, ...summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Server error', message });
  }
}

export async function getContentItems(req: Request, res: Response): Promise<void> {
  const type = req.params.type as ContentType;

  if (!['cars', 'tracks', 'weather'].includes(type)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
    return;
  }

  try {
    const items = await listContent(type);
    if (type === 'cars' || type === 'tracks') {
      const enriched = await Promise.all(
        items.map(async (item) => {
          if (!item.isDirectory) {
            return { ...item, variants: [] as { name: string }[] };
          }
          const variants = await listContentVariants(type, item.name);
          return { ...item, variants };
        }),
      );
      res.json({ ok: true, type, items: enriched });
      return;
    }
    res.json({ ok: true, type, items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Server error', message });
  }
}

export async function getContentPreview(req: Request, res: Response): Promise<void> {
  const type = req.params.type as 'cars' | 'tracks';
  const itemName = String(req.params.name || '');
  const variantName = String(req.params.variant || '');

  if (!['cars', 'tracks'].includes(type)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
    return;
  }

  if (!itemName || !variantName) {
    res.status(400).json({ error: 'Bad request', message: 'Item and variant name required' });
    return;
  }

  const previewPath = resolveVariantPreviewPath(type, itemName, variantName);
  if (!previewPath) {
    res.status(404).json({ error: 'Not found', message: 'Preview not found' });
    return;
  }

  res.setHeader('Content-Type', previewContentType(previewPath));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(previewPath);
}

export async function deleteContentItem(req: Request, res: Response): Promise<void> {
  const type = req.params.type as ContentType;
  const name = String(req.params.name || '');

  if (!['cars', 'tracks', 'weather'].includes(type)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
    return;
  }

  if (!name || name.includes('..') || name.includes('/')) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid item name' });
    return;
  }

  try {
    const result = await deleteContent(type, name);
    if (result.ok) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Server error', message });
  }
}

export async function uploadContent(req: Request, res: Response): Promise<void> {
  const type = req.params.type as ContentType;

  if (!['cars', 'tracks', 'weather'].includes(type)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'Bad request', message: 'No file uploaded' });
    return;
  }

  try {
    const file = req.file;
    let result;

    console.log(`[upload] File: ${file.originalname}, size: ${file.size}, mimetype: ${file.mimetype}`);

    if (file.originalname.endsWith('.zip')) {
      result = await extractZip(type, file.path);
      console.log(`[upload] ZIP result:`, result);
    } else {
      result = await uploadSingleFile(type, file);
    }

    res.json(result);
  } catch (err: unknown) {
    console.error(`[upload] Error:`, err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Server error', message });
  }
}

export async function uploadMultipleContent(req: Request, res: Response): Promise<void> {
  const type = req.params.type as ContentType;

  if (!['cars', 'tracks', 'weather'].includes(type)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
    return;
  }

  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    res.status(400).json({ error: 'Bad request', message: 'No files uploaded' });
    return;
  }

  const results: { file: string; ok: boolean; message: string }[] = [];

  for (const file of req.files) {
    let result;
    if (file.originalname.endsWith('.zip')) {
      result = await extractZip(type, file.path);
    } else {
      result = await uploadSingleFile(type, file);
    }
    results.push({ file: file.originalname, ...result });
  }

  res.json({ ok: true, results });
}

export async function getHudReleasesHandler(_req: Request, res: Response): Promise<void> {
  try {
    const manifest = await listHudReleases();
    res.json({ ok: true, ...manifest });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function uploadHudReleaseHandler(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ ok: false, message: 'No file uploaded' });
    return;
  }

  try {
    const result = await uploadHudRelease(req.file.path, req.file.originalname);
    if (result.ok) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function deleteHudReleaseHandler(req: Request, res: Response): Promise<void> {
  const filename = String(req.params.filename || '');
  try {
    const result = await deleteHudRelease(filename);
    if (result.ok) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function downloadHudReleaseAdminHandler(req: Request, res: Response): Promise<void> {
  const filename = String(req.params.filename || '');
  const filePath = resolveHudReleasePath(filename);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, message: 'Release not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
}

export async function deleteEmptyContentAdminHandler(req: Request, res: Response): Promise<void> {
  const type = parseSyncContentType(String(req.query.type || req.body?.type || ''));
  if (!type) {
    res.status(400).json({ ok: false, message: 'Invalid type — use cars or tracks' });
    return;
  }

  const dryRun = String(req.query.dryRun ?? 'false').toLowerCase() === 'true';
  const namesRaw = req.body?.names ?? req.query.names;
  let names: string[] | undefined;
  if (Array.isArray(namesRaw)) {
    names = namesRaw.map(String);
  } else if (typeof namesRaw === 'string' && namesRaw.trim()) {
    names = namesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  try {
    const result = await deleteEmptyContent(type, names, dryRun);
    res.json({ type, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}
