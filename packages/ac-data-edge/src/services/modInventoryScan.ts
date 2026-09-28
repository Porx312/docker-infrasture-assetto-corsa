import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';

import { contentPoolPath } from './modAgent/materialize.js';

export type ScannedCarMod = {
  carModel: string;
  displayName?: string;
  skins: string[];
};

export type ScannedTrackMod = {
  trackSlug: string;
  configs: string[];
};

export type ModInventoryScanResult = {
  cars: ScannedCarMod[];
  tracks: ScannedTrackMod[];
  etag: string;
  scannedAt: number;
};

/** Same default as mod agent pool — never diverge scan vs materialize. */
function contentBasePath(): string {
  return contentPoolPath();
}

function instanceId(): string {
  return (process.env.AC_INSTANCE_ID || 'default').trim();
}

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

async function listDirNames(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readOptionalUiName(folder: string): Promise<string | undefined> {
  const uiPath = path.join(folder, 'ui_car.json');
  try {
    const raw = await fsp.readFile(uiPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string };
    return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function scanCars(carsDir: string): Promise<ScannedCarMod[]> {
  const models = await listDirNames(carsDir);
  const cars: ScannedCarMod[] = [];
  for (const carModel of models) {
    const carPath = path.join(carsDir, carModel);
    const skinsDir = path.join(carPath, 'skins');
    const skins = await listDirNames(skinsDir);
    const displayName = await readOptionalUiName(carPath);
    cars.push({
      carModel,
      ...(displayName ? { displayName } : {}),
      skins,
    });
  }
  return cars;
}

async function scanTracks(tracksDir: string): Promise<ScannedTrackMod[]> {
  const slugs = await listDirNames(tracksDir);
  const tracks: ScannedTrackMod[] = [];
  for (const trackSlug of slugs) {
    const trackPath = path.join(tracksDir, trackSlug);
    const entries = await fsp.readdir(trackPath, { withFileTypes: true }).catch(() => []);
    const configs: string[] = [''];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'ui') {
        continue;
      }
      const layoutIni = path.join(trackPath, entry.name, 'models.ini');
      const hasLayout =
        fs.existsSync(layoutIni) ||
        fs.existsSync(path.join(trackPath, entry.name, 'data'));
      if (hasLayout || entry.name !== 'data') {
        // Prefer real layout folders (usually contain models.ini / surfaces.ini)
        const looksLikeLayout =
          fs.existsSync(path.join(trackPath, entry.name, 'models.ini')) ||
          fs.existsSync(path.join(trackPath, entry.name, 'surfaces.ini')) ||
          fs.existsSync(path.join(trackPath, entry.name, 'data', 'surfaces.ini'));
        if (looksLikeLayout) {
          configs.push(entry.name);
        }
      }
    }
    tracks.push({
      trackSlug,
      configs: [...new Set(configs)].sort((a, b) => a.localeCompare(b)),
    });
  }
  return tracks;
}

export async function scanLocalModInventory(): Promise<ModInventoryScanResult> {
  const base = contentBasePath();
  const cars = await scanCars(path.join(base, 'cars'));
  const tracks = await scanTracks(path.join(base, 'tracks'));
  const scannedAt = Date.now();
  const etag = createHash('sha256')
    .update(JSON.stringify({ cars, tracks }))
    .digest('hex')
    .slice(0, 24);
  return { cars, tracks, etag, scannedAt };
}

export async function postModInventoryToHub(
  snapshot: ModInventoryScanResult,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const base = getHubWorkerBaseUrl();
  const secret = workerSecret();
  const id = instanceId();
  if (!base) {
    throw new Error('BACKEND_WORKER_URL or BACKEND_INGEST_URL not configured');
  }
  if (!secret) {
    throw new Error('CONVEX_WORKER_SECRET missing');
  }

  const url = `${base.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(id)}/mods`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': secret,
    },
    body: JSON.stringify({
      etag: snapshot.etag,
      scannedAt: snapshot.scannedAt,
      cars: snapshot.cars,
      tracks: snapshot.tracks,
    }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export function isModInventoryScanEnabled(): boolean {
  const raw = (process.env.MOD_INVENTORY_SCAN_ENABLED || 'true').trim().toLowerCase();
  return raw !== 'false';
}

export function modInventoryScanIntervalMs(): number {
  return Number(process.env.MOD_INVENTORY_SCAN_MS || 900_000);
}

let scanTimer: ReturnType<typeof setInterval> | null = null;
let lastEtag = '';

async function runScanTick(): Promise<void> {
  const snapshot = await scanLocalModInventory();
  // Never overwrite a known non-empty hub inventory with an empty first/wrong-path scan.
  if (
    lastEtag === '' &&
    snapshot.cars.length === 0 &&
    snapshot.tracks.length === 0
  ) {
    console.warn(
      `[mod-inventory] skip empty initial scan (path=${contentBasePath()}) — set CONTENT_PATH to the AC content/pool tree`,
    );
    return;
  }
  if (snapshot.etag === lastEtag) {
    console.log(
      `[mod-inventory] unchanged etag=${snapshot.etag} cars=${snapshot.cars.length} tracks=${snapshot.tracks.length}`,
    );
    return;
  }
  const result = await postModInventoryToHub(snapshot);
  if (!result.ok) {
    console.error(`[mod-inventory] POST failed status=${result.status}`, result.body);
    return;
  }
  lastEtag = snapshot.etag;
  console.log(
    `[mod-inventory] reported instanceId=${instanceId()} etag=${snapshot.etag} cars=${snapshot.cars.length} tracks=${snapshot.tracks.length}`,
  );
}

export function startModInventoryScanLoop(): void {
  if (!isModInventoryScanEnabled()) {
    console.log('[mod-inventory] disabled (MOD_INVENTORY_SCAN_ENABLED=false)');
    return;
  }
  if (!getHubWorkerBaseUrl()) {
    console.log('[mod-inventory] skipped (no BACKEND_WORKER_URL / BACKEND_INGEST_URL)');
    return;
  }

  const intervalMs = modInventoryScanIntervalMs();
  console.log(`[mod-inventory] started intervalMs=${intervalMs}`);
  void runScanTick().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mod-inventory] initial scan failed: ${message}`);
  });

  if (scanTimer) {
    clearInterval(scanTimer);
  }
  scanTimer = setInterval(() => {
    void runScanTick().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mod-inventory] scan failed: ${message}`);
    });
  }, intervalMs);
}
