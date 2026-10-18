/**
 * Hub mod preview → public URL for Convex `coverImageId` (string URL, not `_storage`).
 * Host UI uses the URL as img src when it starts with http.
 */
import { modPreviewPublicUrl } from '../mods/modPreviewImages.js';
import { isHostCatalogCoverSyncEnabled } from './env.js';

/**
 * Resolve hub cover to a public URL for `coverImageId`.
 * Returns null when no cover or cover sync disabled (caller omits the field → Host placeholder).
 */
export function resolveCoverImageIdForConvex(input: {
  coverImageFilename?: string | null;
  coverImageUrl?: string | null;
  /** Already a public URL (or legacy storage id) — returned as-is when non-empty. */
  coverImageId?: string | null;
}): string | null {
  const existing = (input.coverImageId || '').trim();
  if (existing) {
    return existing;
  }
  if (!isHostCatalogCoverSyncEnabled()) {
    return null;
  }
  const fromUrl = (input.coverImageUrl || '').trim();
  if (fromUrl) {
    return fromUrl;
  }
  const filename = (input.coverImageFilename || '').trim();
  if (!filename) {
    return null;
  }
  return modPreviewPublicUrl(filename);
}
