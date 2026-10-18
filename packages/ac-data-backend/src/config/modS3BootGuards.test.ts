import assert from 'node:assert/strict';
import test from 'node:test';
import { assertModS3PullBootGuard } from './modS3BootGuards.js';

test('assertModS3PullBootGuard no-ops when storage is not s3', () => {
  const prevMode = process.env.MOD_STORAGE_MODE;
  const prevPull = process.env.MOD_S3_PULL_ENABLED;
  process.env.MOD_STORAGE_MODE = 'local';
  delete process.env.MOD_S3_PULL_ENABLED;
  assert.doesNotThrow(() => assertModS3PullBootGuard());
  if (prevMode === undefined) delete process.env.MOD_STORAGE_MODE;
  else process.env.MOD_STORAGE_MODE = prevMode;
  if (prevPull === undefined) delete process.env.MOD_S3_PULL_ENABLED;
  else process.env.MOD_S3_PULL_ENABLED = prevPull;
});

test('assertModS3PullBootGuard ok when s3 + pull=1', () => {
  const prevMode = process.env.MOD_STORAGE_MODE;
  const prevPull = process.env.MOD_S3_PULL_ENABLED;
  const prevAssetto = process.env.ASSETTO_ENV;
  process.env.MOD_STORAGE_MODE = 's3';
  process.env.MOD_S3_PULL_ENABLED = '1';
  process.env.ASSETTO_ENV = 'dev';
  assert.doesNotThrow(() => assertModS3PullBootGuard());
  if (prevMode === undefined) delete process.env.MOD_STORAGE_MODE;
  else process.env.MOD_STORAGE_MODE = prevMode;
  if (prevPull === undefined) delete process.env.MOD_S3_PULL_ENABLED;
  else process.env.MOD_S3_PULL_ENABLED = prevPull;
  if (prevAssetto === undefined) delete process.env.ASSETTO_ENV;
  else process.env.ASSETTO_ENV = prevAssetto;
});
