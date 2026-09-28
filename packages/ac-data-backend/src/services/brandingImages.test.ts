import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSafeBrandingFilename,
  resolveSafeBrandingImagePath,
} from './brandingImages.js';

test('isSafeBrandingFilename rejects traversal and odd names', () => {
  assert.equal(isSafeBrandingFilename('ok.jpg'), true);
  assert.equal(isSafeBrandingFilename('a-b_1.webp'), true);
  assert.equal(isSafeBrandingFilename('../etc/passwd'), false);
  assert.equal(isSafeBrandingFilename('a/b.jpg'), false);
  assert.equal(isSafeBrandingFilename('noext'), false);
});

test('resolveSafeBrandingImagePath returns null for unsafe names', () => {
  assert.equal(resolveSafeBrandingImagePath('../x.jpg'), null);
  assert.equal(resolveSafeBrandingImagePath(''), null);
});
