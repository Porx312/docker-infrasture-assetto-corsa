import type { Request, Response } from 'express';
import fs from 'fs';
import {
  buildContentManifest,
  parseSyncContentType,
  streamContentZip,
} from '../services/contentSyncService.js';
import {
  getLatestHudRelease,
  resolveHudReleasePath,
} from '../services/projectdHudManager.js';

function requireSyncType(req: Request, res: Response): 'cars' | 'tracks' | null {
  const raw = String(req.query.type ?? req.body?.type ?? req.params.type ?? '');
  const type = parseSyncContentType(raw);
  if (!type) {
    res.status(400).json({ ok: false, message: 'Invalid type — use cars or tracks' });
    return null;
  }
  return type;
}

export async function getHudLatestHandler(_req: Request, res: Response): Promise<void> {
  try {
    const latest = await getLatestHudRelease();
    if (!latest) {
      res.status(404).json({ ok: false, message: 'No HUD release uploaded yet' });
      return;
    }
    res.json({ ok: true, ...latest });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function downloadHudLatestHandler(_req: Request, res: Response): Promise<void> {
  try {
    const latest = await getLatestHudRelease();
    if (!latest) {
      res.status(404).json({ ok: false, message: 'No HUD release uploaded yet' });
      return;
    }
    await downloadHudFile(latest.filename, res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function downloadHudFileHandler(req: Request, res: Response): Promise<void> {
  try {
    await downloadHudFile(String(req.params.filename || ''), res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

async function downloadHudFile(filename: string, res: Response): Promise<void> {
  const filePath = resolveHudReleasePath(filename);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, message: 'Release not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
}

export async function getBootstrapHandler(_req: Request, res: Response): Promise<void> {
  try {
    const [hud, cars, tracks] = await Promise.all([
      getLatestHudRelease(),
      buildContentManifest('cars'),
      buildContentManifest('tracks'),
    ]);

    res.json({
      ok: true,
      hud,
      cars: { count: cars.length, items: cars },
      tracks: { count: tracks.length, items: tracks },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function getContentManifestHandler(req: Request, res: Response): Promise<void> {
  const type = requireSyncType(req, res);
  if (!type) return;

  try {
    const items = await buildContentManifest(type);
    res.json({ ok: true, type, items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function downloadContentHandler(req: Request, res: Response): Promise<void> {
  const type = parseSyncContentType(String(req.params.type || ''));
  const name = String(req.params.name || '');

  if (!type) {
    res.status(400).json({ ok: false, message: 'Invalid content type' });
    return;
  }
  if (!name) {
    res.status(400).json({ ok: false, message: 'Name required' });
    return;
  }

  try {
    await streamContentZip(type, name, res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (!res.headersSent) {
      res.status(500).json({ ok: false, message });
    }
  }
}