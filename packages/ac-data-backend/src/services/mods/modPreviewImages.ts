import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveBrandingPublicBaseUrl } from '../brandingImages.js';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function resolveModPreviewImagesPath(): string {
  const explicit = (process.env.MOD_PREVIEW_IMAGES_PATH || '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const contentPath = (process.env.CONTENT_PATH || '').trim();
  if (contentPath) {
    return path.resolve(path.dirname(contentPath), 'mod-previews');
  }
  return path.resolve(process.cwd(), 'data', 'mod-previews');
}

export function resolveModPreviewPublicBaseUrl(): string {
  return resolveBrandingPublicBaseUrl();
}

export function isModPreviewUploadConfigured(): boolean {
  return Boolean(resolveModPreviewPublicBaseUrl());
}

export async function ensureModPreviewImagesDir(): Promise<string> {
  const dir = resolveModPreviewImagesPath();
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

export function isSafeModPreviewFilename(filename: string): boolean {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext) && /^[a-zA-Z0-9._-]+$/.test(filename);
}

export function resolveSafeModPreviewImagePath(filename: string): string | null {
  if (!isSafeModPreviewFilename(filename)) {
    return null;
  }
  const root = path.resolve(resolveModPreviewImagesPath());
  const full = path.resolve(root, filename);
  const prefix = `${root}${path.sep}`;
  if (full !== root && !full.startsWith(prefix)) {
    return null;
  }
  return full;
}

export function modPreviewPublicUrl(filename: string): string | null {
  const publicBase = resolveModPreviewPublicBaseUrl();
  if (!publicBase || !filename) {
    return null;
  }
  return `${publicBase}/mods/images/${encodeURIComponent(filename)}`;
}

export type ModPreviewStoreResult = {
  filename: string;
  url: string;
};

/** Move uploaded temp file into mod-previews dir; returns public URL. */
export async function storeModPreviewImageFromTemp(
  tempPath: string,
  originalName: string,
  mimeType: string,
  packageId: string,
): Promise<ModPreviewStoreResult> {
  const publicBase = resolveModPreviewPublicBaseUrl();
  if (!publicBase) {
    throw new Error(
      'HUD_PUBLIC_BASE_URL (or PUBLIC_API_BASE_URL / MOD_HUB_PUBLIC_URL) required to build mod preview URLs',
    );
  }

  const ext = extensionForUpload(originalName, mimeType);
  if (!ext) {
    throw new Error('Only JPEG, PNG, WebP, or GIF images are allowed');
  }

  const dir = await ensureModPreviewImagesDir();
  const safePkg = packageId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) || 'mod';
  const filename = `${safePkg}-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`;
  const dest = path.join(dir, filename);

  try {
    await fsp.rename(tempPath, dest);
  } catch {
    await fsp.copyFile(tempPath, dest);
    await fsp.unlink(tempPath).catch(() => undefined);
  }

  return {
    filename,
    url: `${publicBase}/mods/images/${filename}`,
  };
}

export function modPreviewImageContentType(filename: string): string {
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

export async function deleteModPreviewImageFile(filename: string): Promise<boolean> {
  const full = resolveSafeModPreviewImagePath(filename);
  if (!full) {
    throw new Error('Invalid mod preview image filename');
  }
  try {
    await fsp.unlink(full);
    return true;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export function modPreviewImagesDirExists(): boolean {
  try {
    return fs.existsSync(resolveModPreviewImagesPath());
  } catch {
    return false;
  }
}
