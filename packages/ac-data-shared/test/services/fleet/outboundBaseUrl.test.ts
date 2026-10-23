import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOutboundBaseUrl } from '../../../src/services/fleet/outboundBaseUrl.js';

test('accepts http private edge URL by default', () => {
  const prev = process.env.FLEET_OUTBOUND_ALLOW_PRIVATE;
  const allow = process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST;
  delete process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST;
  process.env.FLEET_OUTBOUND_ALLOW_PRIVATE = 'true';
  try {
    const r = assertOutboundBaseUrl('http://10.0.0.2:3000');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.url.origin, 'http://10.0.0.2:3000');
  } finally {
    if (prev !== undefined) process.env.FLEET_OUTBOUND_ALLOW_PRIVATE = prev;
    else delete process.env.FLEET_OUTBOUND_ALLOW_PRIVATE;
    if (allow !== undefined) process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST = allow;
  }
});

test('rejects metadata IP and userinfo', () => {
  assert.equal(assertOutboundBaseUrl('http://169.254.169.254/latest').ok, false);
  assert.equal(assertOutboundBaseUrl('http://user:pass@10.0.0.2:3000').ok, false);
  assert.equal(assertOutboundBaseUrl('ftp://10.0.0.2').ok, false);
  assert.equal(assertOutboundBaseUrl('not a url').ok, false);
});

test('allowlist rejects non-matching host', () => {
  const prev = process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST;
  process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST = 'edge.internal,*.fleet.local';
  try {
    assert.equal(assertOutboundBaseUrl('http://evil.example:3000').ok, false);
    assert.equal(assertOutboundBaseUrl('http://edge.internal:3000').ok, true);
    assert.equal(assertOutboundBaseUrl('https://a.fleet.local').ok, true);
  } finally {
    if (prev !== undefined) process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST = prev;
    else delete process.env.FLEET_OUTBOUND_BASE_URL_ALLOWLIST;
  }
});
