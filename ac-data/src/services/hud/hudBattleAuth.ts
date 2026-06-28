const HUD_API_KEY = process.env.HUD_API_KEY || '';

export function isHudApiKeyValid(provided: unknown): boolean {
  if (!HUD_API_KEY) {
    return true;
  }
  return typeof provided === 'string' && provided === HUD_API_KEY;
}

export function requireHudApiKeyFromQuery(
  apiKey: unknown,
): { ok: true } | { ok: false; status: number; body: { error: string } } {
  if (isHudApiKeyValid(apiKey)) {
    return { ok: true };
  }
  return { ok: false, status: 401, body: { error: 'Unauthorized' } };
}
