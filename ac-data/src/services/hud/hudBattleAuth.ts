export function isHudApiKeyValid(provided: unknown): boolean {
  const hudApiKey = (process.env.HUD_API_KEY || '').trim();
  if (!hudApiKey) {
    return false;
  }
  return typeof provided === 'string' && provided === hudApiKey;
}

export function requireHudApiKeyFromQuery(
  apiKey: unknown,
): { ok: true } | { ok: false; status: number; body: { error: string } } {
  if (isHudApiKeyValid(apiKey)) {
    return { ok: true };
  }
  return { ok: false, status: 401, body: { error: 'Unauthorized' } };
}
