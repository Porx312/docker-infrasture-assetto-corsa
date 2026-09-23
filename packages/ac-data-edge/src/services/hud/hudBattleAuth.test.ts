import { afterEach, describe, expect, it, vi } from 'vitest';

describe('isHudApiKeyValid', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects all requests when HUD_API_KEY is unset', async () => {
    vi.stubEnv('HUD_API_KEY', '');
    const { isHudApiKeyValid } = await import('./hudBattleAuth.js');
    expect(isHudApiKeyValid(undefined)).toBe(false);
    expect(isHudApiKeyValid('any-key')).toBe(false);
  });

  it('accepts matching key when configured', async () => {
    vi.stubEnv('HUD_API_KEY', 'test-hud-key');
    const { isHudApiKeyValid, requireHudApiKeyFromQuery } = await import('./hudBattleAuth.js');
    expect(isHudApiKeyValid('test-hud-key')).toBe(true);
    expect(isHudApiKeyValid('wrong')).toBe(false);
    expect(requireHudApiKeyFromQuery(undefined, 'test-hud-key').ok).toBe(true);
    expect(requireHudApiKeyFromQuery('test-hud-key', undefined).ok).toBe(true);
  });
});
