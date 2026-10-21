import assert from 'node:assert/strict';
import test from 'node:test';

import { promoteArtifactToS3 } from '../../../src/services/mods/promoteArtifactToS3.js';

test('promoteArtifactToS3 no-ops when MOD_S3_CANONICAL_UPLOAD unset (rollback-safe)', async () => {
  const prev = process.env.MOD_S3_CANONICAL_UPLOAD;
  try {
    delete process.env.MOD_S3_CANONICAL_UPLOAD;
    const out = await promoteArtifactToS3('00000000-0000-0000-0000-000000000001');
    assert.equal(out.ok, true);
    assert.equal(out.skipped, 'flag_off');
  } finally {
    if (prev === undefined) delete process.env.MOD_S3_CANONICAL_UPLOAD;
    else process.env.MOD_S3_CANONICAL_UPLOAD = prev;
  }
});
