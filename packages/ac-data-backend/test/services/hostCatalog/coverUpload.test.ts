import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resolveCoverImageIdForConvex } from '../../../src/services/hostCatalog/coverUpload.js';

const prevCoverSync = process.env.CONVEX_HOST_CATALOG_COVER_SYNC;
const prevCatalogSync = process.env.CONVEX_HOST_CATALOG_SYNC;
const prevWorkerSecret = process.env.CONVEX_WORKER_SECRET;
const prevConvexUrl = process.env.CONVEX_DEPLOYMENT_URL;
const prevConvexKey = process.env.CONVEX_PRODUCT_KEY;
const prevPublicBase = process.env.HUD_PUBLIC_BASE_URL;
const prevPublicApi = process.env.PUBLIC_API_BASE_URL;
const prevModHub = process.env.MOD_HUB_PUBLIC_URL;

afterEach(() => {
  if (prevCoverSync !== undefined) process.env.CONVEX_HOST_CATALOG_COVER_SYNC = prevCoverSync;
  else delete process.env.CONVEX_HOST_CATALOG_COVER_SYNC;
  if (prevCatalogSync !== undefined) process.env.CONVEX_HOST_CATALOG_SYNC = prevCatalogSync;
  else delete process.env.CONVEX_HOST_CATALOG_SYNC;
  if (prevWorkerSecret !== undefined) process.env.CONVEX_WORKER_SECRET = prevWorkerSecret;
  else delete process.env.CONVEX_WORKER_SECRET;
  if (prevConvexUrl !== undefined) process.env.CONVEX_DEPLOYMENT_URL = prevConvexUrl;
  else delete process.env.CONVEX_DEPLOYMENT_URL;
  if (prevConvexKey !== undefined) process.env.CONVEX_PRODUCT_KEY = prevConvexKey;
  else delete process.env.CONVEX_PRODUCT_KEY;
  if (prevPublicBase !== undefined) process.env.HUD_PUBLIC_BASE_URL = prevPublicBase;
  else delete process.env.HUD_PUBLIC_BASE_URL;
  if (prevPublicApi !== undefined) process.env.PUBLIC_API_BASE_URL = prevPublicApi;
  else delete process.env.PUBLIC_API_BASE_URL;
  if (prevModHub !== undefined) process.env.MOD_HUB_PUBLIC_URL = prevModHub;
  else delete process.env.MOD_HUB_PUBLIC_URL;
});

function enableCatalogSync(): void {
  process.env.CONVEX_DEPLOYMENT_URL = 'https://example.convex.cloud';
  process.env.CONVEX_PRODUCT_KEY = 'product-key';
  process.env.CONVEX_WORKER_SECRET = 'secret';
  process.env.CONVEX_HOST_CATALOG_SYNC = 'true';
  process.env.CONVEX_HOST_CATALOG_COVER_SYNC = 'true';
  process.env.HUD_PUBLIC_BASE_URL = 'https://hub.example.com';
}

describe('resolveCoverImageIdForConvex', () => {
  it('returns existing coverImageId without building URL', () => {
    process.env.CONVEX_HOST_CATALOG_COVER_SYNC = 'false';
    assert.equal(
      resolveCoverImageIdForConvex({ coverImageId: 'https://cdn.example/cover.jpg' }),
      'https://cdn.example/cover.jpg',
    );
  });

  it('returns null when cover sync disabled and no existing id', () => {
    enableCatalogSync();
    process.env.CONVEX_HOST_CATALOG_COVER_SYNC = 'false';
    assert.equal(
      resolveCoverImageIdForConvex({
        coverImageFilename: 'pkg.png',
        coverImageUrl: 'https://hub.example.com/mods/images/pkg.png',
      }),
      null,
    );
  });

  it('prefers explicit coverImageUrl', () => {
    enableCatalogSync();
    assert.equal(
      resolveCoverImageIdForConvex({
        coverImageFilename: 'other.png',
        coverImageUrl: 'https://hub.example.com/mods/images/explicit.jpg',
      }),
      'https://hub.example.com/mods/images/explicit.jpg',
    );
  });

  it('builds public hub URL from filename', () => {
    enableCatalogSync();
    assert.equal(
      resolveCoverImageIdForConvex({ coverImageFilename: 'pkg-abc.png' }),
      'https://hub.example.com/mods/images/pkg-abc.png',
    );
  });

  it('returns null when no preview (Host placeholder)', () => {
    enableCatalogSync();
    assert.equal(resolveCoverImageIdForConvex({}), null);
    assert.equal(
      resolveCoverImageIdForConvex({ coverImageFilename: null, coverImageUrl: null }),
      null,
    );
  });
});
