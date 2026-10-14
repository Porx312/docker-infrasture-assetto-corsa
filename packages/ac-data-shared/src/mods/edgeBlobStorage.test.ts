import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  edgeBlobStorageKey,
  edgeFolderStorageKey,
  isEdgeBlobStorageKey,
  isEdgeFolderStorageKey,
  isEdgeOwnedStorageKey,
  parseEdgeBlobStorageKey,
  parseEdgeFolderStorageKey,
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

  it('rejects hub keys', () => {
    assert.equal(isEdgeBlobStorageKey('artifacts/sha256/ab/cd/x.zip'), false);
    assert.equal(parseEdgeBlobStorageKey('artifacts/sha256/ab/cd/x.zip'), null);
    assert.equal(isEdgeFolderStorageKey('edge:eu:' + 'a'.repeat(64)), false);
  });
});
