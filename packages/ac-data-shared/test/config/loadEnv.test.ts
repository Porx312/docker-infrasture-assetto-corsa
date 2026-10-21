import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSkipEnvFileLoad } from '../../src/config/loadEnv.js';

test('shouldSkipEnvFileLoad is true when SKIP_ASSETTO_ENV_LOAD=1', () => {
  const prevSkip = process.env.SKIP_ASSETTO_ENV_LOAD;
  const prevNode = process.env.NODE_ENV;
  try {
    process.env.SKIP_ASSETTO_ENV_LOAD = '1';
    delete process.env.NODE_ENV;
    assert.equal(shouldSkipEnvFileLoad(), true);
  } finally {
    if (prevSkip === undefined) delete process.env.SKIP_ASSETTO_ENV_LOAD;
    else process.env.SKIP_ASSETTO_ENV_LOAD = prevSkip;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

test('shouldSkipEnvFileLoad is true when NODE_ENV=test', () => {
  const prevSkip = process.env.SKIP_ASSETTO_ENV_LOAD;
  const prevNode = process.env.NODE_ENV;
  try {
    delete process.env.SKIP_ASSETTO_ENV_LOAD;
    process.env.NODE_ENV = 'test';
    assert.equal(shouldSkipEnvFileLoad(), true);
  } finally {
    if (prevSkip === undefined) delete process.env.SKIP_ASSETTO_ENV_LOAD;
    else process.env.SKIP_ASSETTO_ENV_LOAD = prevSkip;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

test('shouldSkipEnvFileLoad is false outside test isolation', () => {
  const prevSkip = process.env.SKIP_ASSETTO_ENV_LOAD;
  const prevNode = process.env.NODE_ENV;
  try {
    delete process.env.SKIP_ASSETTO_ENV_LOAD;
    process.env.NODE_ENV = 'development';
    assert.equal(shouldSkipEnvFileLoad(), false);
  } finally {
    if (prevSkip === undefined) delete process.env.SKIP_ASSETTO_ENV_LOAD;
    else process.env.SKIP_ASSETTO_ENV_LOAD = prevSkip;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});
