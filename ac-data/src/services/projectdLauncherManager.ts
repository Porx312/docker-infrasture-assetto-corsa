import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import { validateZipFile } from './projectdHudManager.js';

export type LauncherPlatform = 'windows';

export interface LauncherReleaseEntry {
  version: string;
  filename: string;
  size: number;
  uploadedAt: string;
  sha256: string;
  platform: LauncherPlatform;
}

export interface LauncherManifest {
  latest: string | null;
  releases: LauncherReleaseEntry[];
}

const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_BASE_PATH =
  process.env.PROJECTD_LAUNCHER_PATH || path.join(acDataRoot, '..', '..', 'projectd-launcher');

const RELEASES_DIR = 'releases';
const MANIFEST_FILE = 'manifest.json';

function launcherRoot(): string {
  return path.resolve(LAUNCHER_BASE_PATH);
}

function releasesDir(): string {
  return path.join(launcherRoot(), RELEASES_DIR);
}

function manifestPath(): string {
  return path.join(launcherRoot(), MANIFEST_FILE);
}

function maxZipBytes(): number {
  const mb = Number(process.env.CLIENT_SYNC_MAX_ZIP_MB || 500);
  return Math.max(1, mb) * 1024 * 1024;
}

export function resolveSafeLauncherFilename(filename: string): string | null {
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

async function readManifest(): Promise<LauncherManifest> {
  await ensureDirs();
  try {
    const raw = await fs.promises.readFile(manifestPath(), 'utf8');
    const parsed = JSON.parse(raw) as LauncherManifest;
    return {
      latest: parsed.latest ?? null,
      releases: Array.isArray(parsed.releases) ? parsed.releases : [],
    };
  } catch {
    return { latest: null, releases: [] };
  }
}

async function writeManifest(manifest: LauncherManifest): Promise<void> {
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

export async function listLauncherReleases(): Promise<LauncherManifest> {
  return readManifest();
}

export async function getLatestLauncherRelease(): Promise<LauncherReleaseEntry | null> {
  const manifest = await readManifest();
  if (!manifest.latest) {
    return manifest.releases[0] ?? null;
  }
  return manifest.releases.find((r) => r.filename === manifest.latest) ?? manifest.releases[0] ?? null;
}

export function resolveLauncherReleasePath(filename: string): string | null {
  const safe = resolveSafeLauncherFilename(filename);
  if (!safe) return null;
  const target = path.join(releasesDir(), safe);
  const resolved = path.resolve(target);
  const prefix = `${path.resolve(releasesDir())}${path.sep}`;
  if (resolved !== path.resolve(releasesDir()) && !resolved.startsWith(prefix)) {
    return null;
  }
  return resolved;
}

export async function uploadLauncherRelease(
  tempPath: string,
  originalName: string,
): Promise<{ ok: boolean; message: string; release?: LauncherReleaseEntry }> {
  const safeName = resolveSafeLauncherFilename(originalName);
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
    return { ok: false, message: 'File exceeds CLIENT_SYNC_MAX_ZIP_MB limit' };
  }

  const zipCheck = await validateZipFile(tempPath);
  if (!zipCheck.ok) {
    await fs.promises.unlink(tempPath).catch(() => {});
    return { ok: false, message: zipCheck.message };
  }

  await ensureDirs();
  const destPath = path.join(releasesDir(), safeName);
  await fs.promises.copyFile(tempPath, destPath);
  await fs.promises.unlink(tempPath).catch(() => {});

  const sha256 = await sha256File(destPath);
  const entry: LauncherReleaseEntry = {
    version: versionFromFilename(safeName),
    filename: safeName,
    size: stats.size,
    uploadedAt: new Date().toISOString(),
    sha256,
    platform: 'windows',
  };

  const manifest = await readManifest();
  manifest.releases = manifest.releases.filter((r) => r.filename !== safeName);
  manifest.releases.unshift(entry);
  manifest.latest = safeName;
  await writeManifest(manifest);

  return { ok: true, message: `Uploaded ${safeName}`, release: entry };
}

export async function deleteLauncherRelease(filename: string): Promise<{ ok: boolean; message: string }> {
  const filePath = resolveLauncherReleasePath(filename);
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
