import { assertSecurityConfiguration as assertShared } from '@projectd/ac-data-shared/config/securityStartup.js';
import { resolveEnvFilePath } from '@projectd/ac-data-shared/config/loadEnv.js';

export function assertSecurityConfiguration(): void {
  assertShared('edge', resolveEnvFilePath);
  const modAgent =
    (process.env.MOD_AGENT_ENABLED || '').trim().toLowerCase() === 'true' ||
    (process.env.MOD_INVENTORY_SCAN_ENABLED || 'true').trim().toLowerCase() !== 'false';
  if (modAgent && !(process.env.CONTENT_PATH || '').trim()) {
    console.warn(
      '⚠️ CONTENT_PATH is unset — mod inventory/agent require the AC content tree (cars/tracks).',
    );
  }
  if ((process.env.AC_MOD_ROOT || '').trim()) {
    console.warn(
      '⚠️ AC_MOD_ROOT is deprecated (legacy ZIP blobs only). Run gc-blobs then remove it; use CONTENT_PATH.',
    );
  }
}
