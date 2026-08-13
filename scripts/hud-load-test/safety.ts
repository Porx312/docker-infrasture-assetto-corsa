const DEFAULT_ALLOWLIST = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'dev-api.projectd.space',
  'dev-api.projectd.touge.com',
  'staging-api.projectd.space',
];

const PRODUCTION_HOSTS = new Set([
  'api.projectd.space',
  'api.projectd.touge.com',
]);

export function parseAllowlistFromEnv(): string[] {
  const extra = (process.env.HUD_LOAD_TEST_ALLOW_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWLIST, ...extra];
}

export function assertSafeLoadTestTarget(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid HUD load test target URL: ${baseUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`HUD load test target must be http(s): ${baseUrl}`);
  }

  const host = parsed.hostname.toLowerCase();

  if (PRODUCTION_HOSTS.has(host) && process.env.HUD_LOAD_TEST_ALLOW_PROD !== '1') {
    throw new Error(
      `Refusing production HUD target ${host}. ` +
        'Use dev/staging or set HUD_LOAD_TEST_ALLOW_HOSTS for an authorized test host.',
    );
  }

  const allowlist = parseAllowlistFromEnv();
  const allowed = allowlist.some(
    (entry) => host === entry.toLowerCase() || host.endsWith(`.${entry.toLowerCase()}`),
  );

  if (!allowed) {
    throw new Error(
      `HUD load test target ${host} is not allowlisted. ` +
        `Allowed: ${allowlist.join(', ')}. ` +
        'Set HUD_LOAD_TEST_ALLOW_HOSTS to add an authorized test host.',
    );
  }

  return parsed;
}

export function requireLoadTestConfirmation(clients: number, confirmFlag: boolean): void {
  const threshold = Number(process.env.HUD_LOAD_TEST_CONFIRM_CLIENTS ?? 50);
  if (clients >= threshold && !confirmFlag && process.env.HUD_LOAD_TEST_CONFIRM !== '1') {
    throw new Error(
      `Load test with ${clients} clients requires --confirm or HUD_LOAD_TEST_CONFIRM=1 ` +
        `(threshold=${threshold}).`,
    );
  }
}
