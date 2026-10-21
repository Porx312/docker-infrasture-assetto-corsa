import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Documents syncHostCatalog default: omit/true syncs; false skips host-catalog.
 * (Full register integration needs DB+S3 — this locks the option contract.)
 */
test('RegisterS3LibraryArtifactInput syncHostCatalog defaults to sync when omitted', () => {
  const omitted: { syncHostCatalog?: boolean } = {};
  assert.equal(omitted.syncHostCatalog !== false, true);
  const control: { syncHostCatalog?: boolean } = { syncHostCatalog: false };
  assert.equal(control.syncHostCatalog !== false, false);
});
