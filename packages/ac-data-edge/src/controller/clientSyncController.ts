import type { Request, Response } from 'express';
import fs from 'fs';
import { getLatestHudRelease, resolveHudReleasePath } from '../services/projectdHudManager.js';
import { sendZipDownloadFile, setZipDownloadNoCacheHeaders } from '../lib/sendZipDownload.js';

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
  setZipDownloadNoCacheHeaders(res, filename);
  await sendZipDownloadFile(res, filePath);
}

/** Minimal bootstrap for website / tooling — HUD release metadata only. */
export async function getBootstrapHandler(_req: Request, res: Response): Promise<void> {
  try {
    const hud = await getLatestHudRelease();
    res.json({ ok: true, hud });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}
