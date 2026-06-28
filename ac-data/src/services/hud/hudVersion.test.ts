import assert from 'node:assert/strict';
import test from 'node:test';

import { combineSessionVersion } from './hudVersion.js';

test('combineSessionVersion joins board and player versions', () => {
  assert.equal(combineSessionVersion('100', ['200', '300']), '100:200:300');
  assert.equal(combineSessionVersion(null, []), '0');
  assert.equal(combineSessionVersion('50', [null]), '50:0');
});
