import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHudRateLimitKey, extractHudSteamId } from './hudRateLimitKey.js';

function mockReq(query: Record<string, string | undefined>, ip = '203.0.113.10'): {
  query: Record<string, string | undefined>;
  ip: string;
} {
  return { query, ip };
}

test('extractHudSteamId reads steamId query param', () => {
  assert.equal(extractHudSteamId(mockReq({ steamId: '76561198000000001' })), '76561198000000001');
});

test('extractHudSteamId reads first id from steamIds csv', () => {
  assert.equal(
    extractHudSteamId(mockReq({ steamIds: '76561198000000001,76561198000000002' })),
    '76561198000000001',
  );
});

test('extractHudSteamId returns undefined when no player id', () => {
  assert.equal(extractHudSteamId(mockReq({ serverName: 'ProjectD' })), undefined);
});

test('buildHudRateLimitKey uses steam bucket when steamId present', () => {
  const key = buildHudRateLimitKey(
    mockReq({ steamIds: '76561198000000001' }) as Parameters<typeof buildHudRateLimitKey>[0],
  );
  assert.equal(key, 'steam:76561198000000001');
});

test('buildHudRateLimitKey falls back to ip when no steamId', () => {
  const key = buildHudRateLimitKey(
    mockReq({ serverName: 'ProjectD' }) as Parameters<typeof buildHudRateLimitKey>[0],
  );
  assert.match(key, /^203\.0\.113\.10/);
});
