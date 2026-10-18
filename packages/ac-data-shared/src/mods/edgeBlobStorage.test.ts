import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  edgeFolderStorageKey,
  isEdgeFolderStorageKey,
  isEdgeOwnedStorageKey,
  parseEdgeFolderStorageKey,
} from './edgeBlobStorage.js';

describe('edgeBlobStorage', () => {
  it('round-trips edge-folder key', () => {
    const key = edgeFolderStorageKey('eu', 'car', 'ks_ferrari', 'b'.repeat(64));
    assert.equal(isEdgeFolderStorageKey(key), true);
    assert.equal(isEdgeOwnedStorageKey(key), true);
    assert.deepEqual(parseEdgeFolderStorageKey(key), {
      edgeId: 'eu',
      kind: 'car',
      slug: 'ks_ferrari',
      contentHash: 'b'.repeat(64),
    });
  });

  it('rejects hub and legacy edge ZIP keys', () => {
    assert.equal(isEdgeFolderStorageKey('artifacts/sha256/ab/cd/x.zip'), false);
    assert.equal(isEdgeOwnedStorageKey('edge:eu:' + 'a'.repeat(64)), false);
    assert.equal(isEdgeFolderStorageKey('edge:eu:' + 'a'.repeat(64)), false);
  });
});
