/**
 * When a library upload requests a slug that is already taken by a different
 * package, allocate `{base}-c1`, `{base}-c2`, … so tuned/configured variants
 * can coexist without silent replace.
 */
import { getPackageBySlug } from './catalogRepo.js';
import { isModDbConfigured } from './db.js';

export const LIBRARY_SLUG_MAX_CN = 99;

export type AllocatedLibrarySlug = {
  slug: string;
  requestedSlug: string;
  allocated: boolean;
  /** e.g. `c1` when slug is `foo-c1`; null when unchanged. */
  suffix: string | null;
};

async function defaultSlugTaken(slug: string): Promise<boolean> {
  if (!isModDbConfigured()) return false;
  const pkg = await getPackageBySlug(slug);
  return Boolean(pkg);
}

/**
 * Pick a free package slug. If `requestedSlug` is free, returns it unchanged.
 * Otherwise tries `{requestedSlug}-c1` … `-cN` (cap {@link LIBRARY_SLUG_MAX_CN}).
 */
export async function allocateLibrarySlug(
  requestedSlug: string,
  opts?: {
    maxSuffix?: number;
    slugTaken?: (slug: string) => Promise<boolean>;
  },
): Promise<AllocatedLibrarySlug> {
  const base = String(requestedSlug || '').trim();
  if (!base || base.includes('..') || base.includes('/')) {
    throw new Error('slug_required');
  }
  const slugTaken = opts?.slugTaken ?? defaultSlugTaken;
  const maxSuffix = opts?.maxSuffix ?? LIBRARY_SLUG_MAX_CN;

  if (!(await slugTaken(base))) {
    return {
      slug: base,
      requestedSlug: base,
      allocated: false,
      suffix: null,
    };
  }

  for (let n = 1; n <= maxSuffix; n += 1) {
    const candidate = `${base}-c${n}`;
    if (!(await slugTaken(candidate))) {
      return {
        slug: candidate,
        requestedSlug: base,
        allocated: true,
        suffix: `c${n}`,
      };
    }
  }

  throw new Error(`slug_allocate_exhausted: no free -cN for ${base} (max ${maxSuffix})`);
}

/** When displayName was just the folder slug, append ` (cN)` for Host cards. */
export function displayNameForAllocatedSlug(
  displayName: string,
  requestedSlug: string,
  suffix: string | null,
): string {
  const name = String(displayName || '').trim() || requestedSlug;
  if (!suffix) return name;
  if (name === requestedSlug) return `${requestedSlug} (${suffix})`;
  return name;
}
