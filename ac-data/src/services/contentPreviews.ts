import fs from 'fs';
import path from 'path';
import type { ContentType } from './contentManager.js';
import { getContentPath } from './contentManager.js';

export interface ContentVariant {
  name: string;
}

const PREVIEW_CANDIDATES = [
  'preview.jpg',
  'preview.png',
  'Preview.jpg',
  'Preview.png',
  'livery.png',
  'map.png',
];

function isPathInside(base: string, target: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function findPreviewFile(dir: string): string | null {
  for (const name of PREVIEW_CANDIDATES) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // skip
    }
  }
  return null;
}

async function listSubdirNames(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function listCarSkins(carName: string): Promise<ContentVariant[]> {
  const carDir = path.join(getContentPath('cars'), carName);
  const skinsDir = path.join(carDir, 'skins');
  if (!isPathInside(getContentPath('cars'), skinsDir)) {
    return [];
  }

  const skinNames = await listSubdirNames(skinsDir);
  return skinNames.map((name) => ({ name }));
}

export async function listTrackLayouts(trackName: string): Promise<ContentVariant[]> {
  const trackDir = path.join(getContentPath('tracks'), trackName);
  const uiDir = path.join(trackDir, 'ui');
  if (!isPathInside(getContentPath('tracks'), uiDir)) {
    return [];
  }

  const layoutNames = await listSubdirNames(uiDir);
  return layoutNames.map((name) => ({ name }));
}

export async function listContentVariants(
  type: ContentType,
  itemName: string,
): Promise<ContentVariant[]> {
  if (type === 'cars') {
    return listCarSkins(itemName);
  }
  if (type === 'tracks') {
    return listTrackLayouts(itemName);
  }
  return [];
}

export function resolveVariantPreviewPath(
  type: 'cars' | 'tracks',
  itemName: string,
  variantName: string,
): string | null {
  if (itemName.includes('..') || itemName.includes('/') || itemName.includes('\\')) {
    return null;
  }
  if (variantName.includes('..') || variantName.includes('/') || variantName.includes('\\')) {
    return null;
  }

  const baseDir = getContentPath(type);
  const itemDir = path.join(baseDir, itemName);
  if (!isPathInside(baseDir, itemDir) || !fs.existsSync(itemDir)) {
    return null;
  }

  if (type === 'cars') {
    const skinDir = path.join(itemDir, 'skins', variantName);
    if (!isPathInside(itemDir, skinDir)) {
      return null;
    }
    return findPreviewFile(skinDir);
  }

  const layoutDir = path.join(itemDir, 'ui', variantName);
  if (!isPathInside(itemDir, layoutDir)) {
    return null;
  }
  const preview = findPreviewFile(layoutDir);
  if (preview) {
    return preview;
  }

  const layoutDataDir = path.join(itemDir, variantName);
  if (isPathInside(itemDir, layoutDataDir)) {
    return findPreviewFile(layoutDataDir);
  }

  return null;
}

export function previewContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
