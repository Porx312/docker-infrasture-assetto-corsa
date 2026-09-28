import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function resolveBrandingImagesPath(): string {
  const explicit = (process.env.BRANDING_IMAGES_PATH || '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const contentPath = (process.env.CONTENT_PATH || '').trim();
  if (contentPath) {
    return path.resolve(path.dirname(contentPath), 'branding');
  }
  return path.resolve(process.cwd(), 'data', 'branding');
}

export function resolveBrandingPublicBaseUrl(): string {
  return (
    (process.env.HUD_PUBLIC_BASE_URL || '').trim() ||
    (process.env.PUBLIC_API_BASE_URL || '').trim() ||
    (process.env.MOD_HUB_PUBLIC_URL || '').trim()
  ).replace(/\/+$/, '');
}

export function isBrandingImageUploadConfigured(): boolean {
  return Boolean(resolveBrandingPublicBaseUrl());
}

export async function ensureBrandingImagesDir(): Promise<string> {
  const dir = resolveBrandingImagesPath();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function extensionForUpload(originalName: string, mimeType: string): string | null {
  const fromMime = EXT_BY_MIME[mimeType.toLowerCase()];
  if (fromMime) {
    return fromMime;
  }
  const ext = path.extname(originalName).toLowerCase();
  if (ALLOWED_EXT.has(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return null;
}

export function isSafeBrandingFilename(filename: string): boolean {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext) && /^[a-zA-Z0-9._-]+$/.test(filename);
}

export function resolveSafeBrandingImagePath(filename: string): string | null {
  if (!isSafeBrandingFilename(filename)) {
    return null;
  }
  const root = path.resolve(resolveBrandingImagesPath());
  const full = path.resolve(root, filename);
  const prefix = `${root}${path.sep}`;
  if (full !== root && !full.startsWith(prefix)) {
    return null;
  }
  return full;
}

export type BrandingImageStoreResult = {
  filename: string;
  url: string;
};

/** Move uploaded temp file into branding dir; returns public URL for CM. */
export async function storeBrandingImageFromTemp(
  tempPath: string,
  originalName: string,
  mimeType: string,
): Promise<BrandingImageStoreResult> {
  const publicBase = resolveBrandingPublicBaseUrl();
  if (!publicBase) {
    throw new Error(
      'HUD_PUBLIC_BASE_URL (or PUBLIC_API_BASE_URL) required to build branding image URLs',
    );
  }

  const ext = extensionForUpload(originalName, mimeType);
  if (!ext) {
    throw new Error('Only JPEG, PNG, WebP, or GIF images are allowed');
  }

  const dir = await ensureBrandingImagesDir();
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
  const dest = path.join(dir, filename);

  try {
    await fsp.rename(tempPath, dest);
  } catch {
    await fsp.copyFile(tempPath, dest);
    await fsp.unlink(tempPath).catch(() => undefined);
  }

  return {
    filename,
    url: `${publicBase}/branding/images/${filename}`,
  };
}

export function brandingImageContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

export function brandingImagesDirExists(): boolean {
  try {
    return fs.existsSync(resolveBrandingImagesPath());
  } catch {
    return false;
  }
}

export type BrandingImageListItem = {
  filename: string;
  url: string;
  sizeBytes: number;
  modifiedAt: number;
};

/** List images under branding dir (newest first). */
export async function listBrandingImages(): Promise<BrandingImageListItem[]> {
  const publicBase = resolveBrandingPublicBaseUrl();
  if (!publicBase) {
    return [];
  }

  const dir = resolveBrandingImagesPath();
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }

  /** @type {BrandingImageListItem[]} */
  const items: BrandingImageListItem[] = [];
  for (const filename of entries) {
    if (!isSafeBrandingFilename(filename)) continue;
    const full = resolveSafeBrandingImagePath(filename);
    if (!full) continue;
    try {
      const st = await fsp.stat(full);
      if (!st.isFile()) continue;
      items.push({
        filename,
        url: `${publicBase}/branding/images/${filename}`,
        sizeBytes: st.size,
        modifiedAt: st.mtimeMs,
      });
    } catch {
      /* skip */
    }
  }

  items.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return items;
}

/** Delete a branding image file from disk. Returns true if removed. */
export async function deleteBrandingImageFile(filename: string): Promise<boolean> {
  const full = resolveSafeBrandingImagePath(filename);
  if (!full) {
    throw new Error('Invalid branding image filename');
  }
  try {
    await fsp.unlink(full);
    return true;
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
