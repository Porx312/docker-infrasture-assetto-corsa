import assert from 'node:assert/strict';
import test from 'node:test';

import { promoteLibraryPackageToHostCatalog } from '../../../src/services/mods/s3LibraryRegister.js';

test('promoteLibraryPackageToHostCatalog rejects non car/track kinds', async () => {
  const result = await promoteLibraryPackageToHostCatalog({
    packageId: '00000000-0000-0000-0000-000000000001',
    artifactId: '00000000-0000-0000-0000-000000000002',
    kind: 'weather',
    acContentSlug: 'wx',
    displayName: 'Weather',
  });
  assert.equal(result.synced, false);
  assert.match(String(result.error || ''), /not synced/i);
});
