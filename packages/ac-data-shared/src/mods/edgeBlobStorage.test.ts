import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  edgeBlobStorageKey,
  isEdgeBlobStorageKey,
  parseEdgeBlobStorageKey,
} from './edgeBlobStorage.js';

describe('edgeBlobStorage', () => {
  it('round-trips edge key', () => {
    const key = edgeBlobStorageKey('eu', 'a'.repeat(64));
    assert.equal(isEdgeBlobStorageKey(key), true);
    assert.deepEqual(parseEdgeBlobStorageKey(key), {
      edgeId: 'eu',
      sha256: 'a'.repeat(64),
    });
  });

  it('rejects hub keys', () => {
    assert.equal(isEdgeBlobStorageKey('artifacts/sha256/ab/cd/x.zip'), false);
    assert.equal(parseEdgeBlobStorageKey('artifacts/sha256/ab/cd/x.zip'), null);
  });
});
