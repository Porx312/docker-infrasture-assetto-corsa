export function isHudApiKeyValid(provided: unknown): boolean {
  const hudApiKey = (process.env.HUD_API_KEY || '').trim();
  if (!hudApiKey) {
    return false;
  }
  return typeof provided === 'string' && provided === hudApiKey;
}

function readProvidedApiKey(apiKey: unknown, headerApiKey: unknown): unknown {
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return apiKey.trim();
  }
  if (typeof headerApiKey === 'string' && headerApiKey.trim()) {
    return headerApiKey.trim();
  }
  if (Array.isArray(headerApiKey)) {
    const first = headerApiKey.find((value) => typeof value === 'string' && value.trim());
    return typeof first === 'string' ? first.trim() : undefined;
  }
  return undefined;
}

export function requireHudApiKeyFromQuery(
  apiKey: unknown,
  headerApiKey?: unknown,
): { ok: true } | { ok: false; status: number; body: { error: string } } {
  const provided = readProvidedApiKey(apiKey, headerApiKey);
  if (isHudApiKeyValid(provided)) {
    return { ok: true };
  }
  return { ok: false, status: 401, body: { error: 'Unauthorized' } };
}
