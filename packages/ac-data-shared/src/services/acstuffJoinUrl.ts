/** Content Manager one-click join via acstuff.club. */

const ACSTUFF_JOIN_BASE = 'https://acstuff.club/s/q:race/online/join';

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') {
    return true;
  }
  if (h.endsWith('.localhost') || h.endsWith('.local')) {
    return true;
  }
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

/** Hostname from edge baseUrl suitable for public join links (null if local/private). */
export function joinIpFromBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    const host = url.hostname.trim();
    if (!host || isPrivateOrLocalHost(host)) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

/** Build acstuff join URL, or null when ip/httpPort are missing/invalid. */
export function buildAcstuffJoinUrl(
  ip: string | null | undefined,
  httpPort: number | null | undefined,
): string | null {
  const host = typeof ip === 'string' ? ip.trim() : '';
  if (!host || isPrivateOrLocalHost(host)) {
    return null;
  }
  if (typeof httpPort !== 'number' || !Number.isFinite(httpPort) || httpPort <= 0) {
    return null;
  }
  const port = Math.trunc(httpPort);
  return `${ACSTUFF_JOIN_BASE}?ip=${encodeURIComponent(host)}&httpPort=${port}`;
}
