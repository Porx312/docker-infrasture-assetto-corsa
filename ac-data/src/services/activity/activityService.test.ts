import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesCategory, matchesSearch, matchesServer, normalizeStreamEntry } from './activityNormalize.js';
import { dayBoundsLocal, dayBoundsUtc, localTodayIso, parseStreamRow, todayUtcIso } from './activityService.js';

test('dayBoundsUtc returns UTC midnight bounds for calendar day', () => {
  const { since, until } = dayBoundsUtc('2026-08-01');
  assert.equal(since, Date.UTC(2026, 7, 1));
  assert.equal(until, since + 86_400_000);
});

test('dayBoundsLocal applies tz offset for UTC+2', () => {
  const { since, until } = dayBoundsLocal('2026-08-02', 120);
  assert.equal(since, Date.UTC(2026, 7, 1, 22, 0, 0));
  assert.equal(until, since + 86_400_000);
});

test('dayBoundsLocal applies tz offset for UTC-5', () => {
  const { since } = dayBoundsLocal('2026-08-02', -300);
  assert.equal(since, Date.UTC(2026, 7, 2, 5, 0, 0));
});

test('todayUtcIso returns YYYY-MM-DD', () => {
  const iso = todayUtcIso();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});

test('localTodayIso uses tz offset', () => {
  const utcMidnight = Date.UTC(2026, 7, 2, 1, 0, 0);
  const originalNow = Date.now;
  Date.now = () => utcMidnight;
  try {
    assert.equal(localTodayIso(120), '2026-08-02');
    assert.equal(localTodayIso(0), '2026-08-02');
  } finally {
    Date.now = originalNow;
  }
});

test('parseStreamRow parses Redis stream message fields', () => {
  const parsed = parseStreamRow('1700000000000-0', {
    event: 'player_join',
    serverName: 'Main Touge',
    ts: '1700000000000',
    payload: JSON.stringify({
      event: 'player_join',
      serverName: 'Main Touge',
      ts: 1700000000000,
      data: { name: 'Grego', steamId: '76561199150078952' },
    }),
  });

  assert.ok(parsed);
  assert.equal(parsed!.event, 'player_join');
  assert.equal(parsed!.serverName, 'Main Touge');
  assert.equal(parsed!.ts, 1700000000000);
});

test('timeline filters apply after normalization', () => {
  const entry = parseStreamRow('1-0', {
    event: 'lap_completed',
    serverName: 'Main Touge',
    ts: String(Date.now()),
    payload: JSON.stringify({
      data: { name: 'Minty', lapTime: 207_443, isPersonalBest: true, trackName: 'pk_akina' },
    }),
  });
  assert.ok(entry);

  const item = normalizeStreamEntry(entry!);
  assert.ok(item);
  assert.equal(matchesCategory(item!, 'records'), true);
  assert.equal(matchesCategory(item!, 'connections'), false);
  assert.equal(matchesServer(item!, 'Main Touge'), true);
  assert.equal(matchesSearch(item!, 'minty'), true);
});

test('parseStreamRow returns null without event field', () => {
  assert.equal(parseStreamRow('1-0', { serverName: 'x' }), null);
});
