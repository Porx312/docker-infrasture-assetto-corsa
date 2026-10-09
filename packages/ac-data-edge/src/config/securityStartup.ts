import { assertSecurityConfiguration as assertShared } from '@projectd/ac-data-shared/config/securityStartup.js';
import { resolveEnvFilePath } from '@projectd/ac-data-shared/config/loadEnv.js';

export function assertSecurityConfiguration(): void {
  assertShared('edge', resolveEnvFilePath);
}
