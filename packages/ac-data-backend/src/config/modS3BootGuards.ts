/**
 * Fail loud when Contabo library mode is configured without pull enabled.
 * Prevents silent "Sync failed" on edges when installs are rejected at ensure/acquire.
 */
import { isModS3PullEnabled } from '@projectd/ac-data-shared/mods/modS3Manifest.js';

function storageMode(): string {
  return (process.env.MOD_STORAGE_MODE || 'local').trim().toLowerCase();
}

function isProductionLike(): boolean {
  const env = (process.env.ASSETTO_ENV || 'dev').trim().toLowerCase();
  return env === 'prod' || env === 'production';
}

export function assertModS3PullBootGuard(): void {
  if (storageMode() !== 's3') {
    return;
  }
  if (isModS3PullEnabled()) {
    console.log('[mod-s3] STORAGE_MODE=s3 MOD_S3_PULL_ENABLED=1 (library install OK)');
    return;
  }
  const msg =
    '[mod-s3] FATAL: MOD_STORAGE_MODE=s3 but MOD_S3_PULL_ENABLED is not 1 — ' +
    'edge installs from Contabo will fail with Sync failed / artifact_blob_missing. ' +
    'Set MOD_S3_PULL_ENABLED=1 in .env.local and restart (unset any empty shell export first).';
  console.error(msg);
  if (isProductionLike()) {
    throw new Error(msg);
  }
}
