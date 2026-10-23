/**
 * Validate hub→edge / registry outbound base URLs (SSRF hardening).
 * Private RFC1918 is allowed by default (fleet edges on LAN).
 */

import { envBool, envString } from '../../config/env.js';

const BLOCKED_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

/** Cloud / link-local metadata endpoints — never allow as fleet baseUrl. */
const BLOCKED_IPS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'fd00:ec2::254',
]);

export type OutboundBaseUrlOk = { ok: true; url: URL };
export type OutboundBaseUrlErr = { ok: false; reason: string };
export type OutboundBaseUrlResult = OutboundBaseUrlOk | OutboundBaseUrlErr;

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function parseIpv4(host: string): number[] | null {
  if (!isIpv4(host)) return null;
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts;
}

function isPrivateOrLoopbackIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local (incl. metadata)
  if (a === 0) return true;
  return false;
}

function hostMatchesAllowlist(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  for (const raw of allowlist) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith('*.') && host.endsWith(entry.slice(1))) return true;
    if (host === entry) return true;
  }
  return false;
}

/**
 * Parse and validate an outbound fleet/HUD edge base URL.
 */
export function assertOutboundBaseUrl(raw: string): OutboundBaseUrlResult {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty_base_url' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme_not_allowed' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'userinfo_not_allowed' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    return { ok: false, reason: 'missing_hostname' };
  }
  if (BLOCKED_HOSTS.has(hostname)) {
    return { ok: false, reason: 'blocked_metadata_host' };
  }
  if (BLOCKED_IPS.has(hostname)) {
    return { ok: false, reason: 'blocked_metadata_ip' };
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    // Explicit metadata / AWS IMDS
    if (hostname === '169.254.169.254') {
      return { ok: false, reason: 'blocked_metadata_ip' };
    }
    const allowPrivate = envBool('FLEET_OUTBOUND_ALLOW_PRIVATE', true);
    if (!allowPrivate && isPrivateOrLoopbackIpv4(ipv4)) {
      return { ok: false, reason: 'private_ip_not_allowed' };
    }
    // Always block link-local 169.254.0.0/16 except we already allow private —
    // still block the known metadata IP above; other 169.254 are odd for fleet.
    if (ipv4[0] === 169 && ipv4[1] === 254 && hostname !== '169.254.169.254') {
      // link-local non-IMDS: reject always (not a normal edge bind)
      return { ok: false, reason: 'link_local_not_allowed' };
    }
  }

  if (hostname === 'localhost' || hostname === '::1') {
    const allowPrivate = envBool('FLEET_OUTBOUND_ALLOW_PRIVATE', true);
    if (!allowPrivate) {
      return { ok: false, reason: 'private_ip_not_allowed' };
    }
  }

  const allowlistRaw = envString('FLEET_OUTBOUND_BASE_URL_ALLOWLIST');
  if (allowlistRaw) {
    const entries = allowlistRaw.split(/[,;\s]+/).filter(Boolean);
    if (entries.length && !hostMatchesAllowlist(hostname, entries)) {
      return { ok: false, reason: 'host_not_in_allowlist' };
    }
  }

  return { ok: true, url };
}

/** Throw with stable message prefix for callers that prefer exceptions. */
export function requireOutboundBaseUrl(raw: string): URL {
  const result = assertOutboundBaseUrl(raw);
  if (!result.ok) {
    throw new Error(`invalid_outbound_base_url: ${result.reason}`);
  }
  return result.url;
}
