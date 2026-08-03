import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';

export interface HudReleaseEntry {
  version: string;
  filename: string;
  size: number;
  uploadedAt: string;
  sha256: string;
}

export interface HudManifest {
  latest: string | null;
  releases: HudReleaseEntry[];
}

const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const HUD_BASE_PATH =
  process.env.PROJECTD_HUD_PATH || path.join(acDataRoot, '..', '..', 'projectd-hud');

const RELEASES_DIR = 'releases';
const MANIFEST_FILE = 'manifest.json';

function hudRoot(): string {
  return path.resolve(HUD_BASE_PATH);
}

function releasesDir(): string {
  return path.join(hudRoot(), RELEASES_DIR);
}

function manifestPath(): string {
  return path.join(hudRoot(), MANIFEST_FILE);
}

function maxZipBytes(): number {
  const mb = Number(process.env.CLIENT_SYNC_MAX_ZIP_MB || 500);
  return Math.max(1, mb) * 1024 * 1024;
}

export function resolveSafeHudFilename(filename: string): string | null {
  const base = path.basename(filename.replace(/\\/g, '/'));
  if (!base || base.includes('..') || base !== filename.replace(/\\/g, '/')) {
    return null;
  }
  if (!base.toLowerCase().endsWith('.zip')) {
    return null;
  }
  return base;
}

async function ensureDirs(): Promise<void> {
  await fs.promises.mkdir(releasesDir(), { recursive: true });
}

async function readManifest(): Promise<HudManifest> {
  await ensureDirs();
  try {
    const raw = await fs.promises.readFile(manifestPath(), 'utf8');
    const parsed = JSON.parse(raw) as HudManifest;
    return {
      latest: parsed.latest ?? null,
      releases: Array.isArray(parsed.releases) ? parsed.releases : [],
    };
  } catch {
    return { latest: null, releases: [] };
  }
}

async function writeManifest(manifest: HudManifest): Promise<void> {
  await ensureDirs();
  await fs.promises.writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function versionFromFilename(filename: string): string {
  const base = filename.replace(/\.zip$/i, '');
  const match = base.match(/v?\d+(?:\.\d+)*/i);
  return match?.[0] ?? base;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function listHudReleases(): Promise<HudManifest> {
  return readManifest();
}

export async function getLatestHudRelease(): Promise<HudReleaseEntry | null> {
  const manifest = await readManifest();
  if (!manifest.latest) {
    return manifest.releases[0] ?? null;
  }
  return manifest.releases.find((r) => r.filename === manifest.latest) ?? manifest.releases[0] ?? null;
}

export function resolveHudReleasePath(filename: string): string | null {
  const safe = resolveSafeHudFilename(filename);
  if (!safe) return null;
  const target = path.join(releasesDir(), safe);
  const resolved = path.resolve(target);
  const prefix = `${path.resolve(releasesDir())}${path.sep}`;
  if (resolved !== path.resolve(releasesDir()) && !resolved.startsWith(prefix)) {
    return null;
  }
  return resolved;
}

export async function uploadHudRelease(
  tempPath: string,
  originalName: string,
): Promise<{ ok: boolean; message: string; release?: HudReleaseEntry }> {
  const safeName = resolveSafeHudFilename(originalName);
  if (!safeName) {
    return { ok: false, message: 'Invalid filename — must be a .zip without path segments' };
  }

  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(tempPath);
  } catch {
    return { ok: false, message: 'Upload file not found' };
  }

  if (stats.size > maxZipBytes()) {
    return { ok: false, message: `File exceeds CLIENT_SYNC_MAX_ZIP_MB limit` };
  }

  await ensureDirs();
  const destPath = path.join(releasesDir(), safeName);
  await fs.promises.copyFile(tempPath, destPath);
  await fs.promises.unlink(tempPath).catch(() => {});

  const sha256 = await sha256File(destPath);
  const entry: HudReleaseEntry = {
    version: versionFromFilename(safeName),
    filename: safeName,
    size: stats.size,
    uploadedAt: new Date().toISOString(),
    sha256,
  };

  const manifest = await readManifest();
  manifest.releases = manifest.releases.filter((r) => r.filename !== safeName);
  manifest.releases.unshift(entry);
  manifest.latest = safeName;
  await writeManifest(manifest);

  return { ok: true, message: `Uploaded ${safeName}`, release: entry };
}

export async function deleteHudRelease(filename: string): Promise<{ ok: boolean; message: string }> {
  const filePath = resolveHudReleasePath(filename);
  if (!filePath) {
    return { ok: false, message: 'Invalid filename' };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: 'Release not found' };
  }

  await fs.promises.unlink(filePath);
  const manifest = await readManifest();
  manifest.releases = manifest.releases.filter((r) => r.filename !== filename);
  if (manifest.latest === filename) {
    manifest.latest = manifest.releases[0]?.filename ?? null;
  }
  await writeManifest(manifest);
  return { ok: true, message: `Deleted ${filename}` };
}
