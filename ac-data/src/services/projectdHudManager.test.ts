import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSafeHudFilename } from './projectdHudManager.js';

test('resolveSafeHudFilename accepts zip basename', () => {
  assert.equal(resolveSafeHudFilename('projectd-hud-v1.0.0.zip'), 'projectd-hud-v1.0.0.zip');
});

test('resolveSafeHudFilename rejects path traversal', () => {
  assert.equal(resolveSafeHudFilename('../evil.zip'), null);
  assert.equal(resolveSafeHudFilename('sub/release.zip'), null);
});

test('resolveSafeHudFilename rejects non-zip', () => {
  assert.equal(resolveSafeHudFilename('readme.txt'), null);
});
