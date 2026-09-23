import { afterEach, describe, expect, it, vi } from 'vitest';

describe('assertSecurityConfiguration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exits when HUD_API_KEY missing and insecure defaults disallowed', async () => {
    vi.stubEnv('HUD_API_KEY', '');
    vi.stubEnv('ADMIN_USER', 'admin');
    vi.stubEnv('ADMIN_PASS', 'long-enough-password-123');
    vi.stubEnv('ADMIN_JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('ALLOW_INSECURE_DEFAULTS', 'false');
    vi.stubEnv('ASSETTO_ENV', 'dev');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { assertSecurityConfiguration } = await import('./securityStartup.js');
    assertSecurityConfiguration();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
