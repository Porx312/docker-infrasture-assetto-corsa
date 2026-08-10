import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSyncContentType } from './contentAdminHelpers.js';

test('parseSyncContentType accepts cars and tracks', () => {
  assert.equal(parseSyncContentType('cars'), 'cars');
  assert.equal(parseSyncContentType('tracks'), 'tracks');
  assert.equal(parseSyncContentType('weather'), null);
  assert.equal(parseSyncContentType(''), null);
});
