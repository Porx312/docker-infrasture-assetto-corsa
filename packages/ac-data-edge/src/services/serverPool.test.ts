import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { isServerPoolMode, shouldStartFromConfig } from './serverPool.js';

const originalPoolMode = process.env.SERVER_POOL_MODE;

afterEach(() => {
  if (originalPoolMode === undefined) {
    delete process.env.SERVER_POOL_MODE;
  } else {
    process.env.SERVER_POOL_MODE = originalPoolMode;
  }
});

test('shouldStartFromConfig allows active servers in normal mode', () => {
  delete process.env.SERVER_POOL_MODE;
  assert.equal(shouldStartFromConfig(true), true);
  assert.equal(shouldStartFromConfig(undefined), true);
  assert.equal(shouldStartFromConfig(false), false);
});

test('shouldStartFromConfig requires explicit isActive in pool mode', () => {
  process.env.SERVER_POOL_MODE = 'true';
  assert.equal(isServerPoolMode(), true);
  assert.equal(shouldStartFromConfig(true), true);
  assert.equal(shouldStartFromConfig(undefined), false);
  assert.equal(shouldStartFromConfig(false), false);
});
