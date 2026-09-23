import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  getHubWorkerBaseUrl,
  isEdgeConfigSyncEnabled,
  isHubWorkerMode,
  shouldEdgeUseDirectConvex,
} from './hubWorkerUrl.js';

const envKeys = [
  'BACKEND_WORKER_URL',
  'BACKEND_INGEST_URL',
  'CONVEX_DIRECT_ON_EDGE',
  'REDIS_CONFIG_SYNC_ON_EDGE',
] as const;

const prev: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of envKeys) {
    if (prev[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev[key];
    }
  }
});

function saveEnv(): void {
  for (const key of envKeys) {
    prev[key] = process.env[key];
  }
}

test('getHubWorkerBaseUrl prefers BACKEND_WORKER_URL', () => {
  saveEnv();
  process.env.BACKEND_WORKER_URL = 'https://hub.example/';
  process.env.BACKEND_INGEST_URL = 'https://other.example';
  assert.equal(getHubWorkerBaseUrl(), 'https://hub.example');
  assert.equal(isHubWorkerMode(), true);
});

test('shouldEdgeUseDirectConvex false when hub worker mode', () => {
  saveEnv();
  process.env.BACKEND_INGEST_URL = 'https://hub.example';
  delete process.env.CONVEX_DIRECT_ON_EDGE;
  assert.equal(shouldEdgeUseDirectConvex(), false);
});

test('isEdgeConfigSyncEnabled false in hub worker mode by default', () => {
  saveEnv();
  process.env.BACKEND_WORKER_URL = 'https://hub.example';
  delete process.env.REDIS_CONFIG_SYNC_ON_EDGE;
  delete process.env.CONVEX_DIRECT_ON_EDGE;
  assert.equal(isEdgeConfigSyncEnabled(), false);
});
