import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLapMs } from './activityFormat.js';
import {
  buildJoinNameIndex,
  matchesCategory,
  matchesServer,
  normalizeStreamEntry,
  upsertUniquePlayerJoin,
} from './activityNormalize.js';
import { summarizeServers } from '../serverBranding.js';
import type { ParsedStreamEntry } from './activityTypes.js';

function entry(
  event: string,
  data: Record<string, unknown>,
  overrides: Partial<ParsedStreamEntry> = {},
): ParsedStreamEntry {
  return {
    streamId: '1700000000000-0',
    event,
    serverName: 'Main Touge',
    ts: 1_700_000_000_000,
    payload: { event, serverName: 'Main Touge', ts: 1_700_000_000_000, data },
    ...overrides,
  };
}

test('formatLapMs renders minutes and seconds', () => {
  assert.equal(formatLapMs(207_443), '3:27.443');
});

test('normalizeStreamEntry maps player_join', () => {
  const item = normalizeStreamEntry(
    entry('player_join', {
      name: 'Grego',
      steamId: '76561199150078952',
      carModel: 'ks_toyota_gt86',
      trackName: 'pk_akina',
    }),
  );
  assert.ok(item);
  assert.equal(item!.kind, 'join');
  assert.match(item!.title, /Grego joined/);
  assert.equal(matchesCategory(item!, 'connections'), true);
});

test('normalizeStreamEntry maps player_leave with name', () => {
  const item = normalizeStreamEntry(
    entry('player_leave', {
      name: 'Grego',
      steamId: '76561199150078952',
      trackName: 'pk_akina',
    }),
  );
  assert.ok(item);
  assert.equal(item!.kind, 'leave');
  assert.match(item!.title, /Grego left/);
  assert.equal(matchesCategory(item!, 'connections'), true);
});

test('normalizeStreamEntry enriches leave name from join index', () => {
  const joinNames = buildJoinNameIndex([
    entry('player_join', { name: 'PORX', steamId: '76561198275021746' }),
  ]);
  const item = normalizeStreamEntry(
    entry('player_leave', { steamId: '76561198275021746', trackName: 'pk_akina' }),
    joinNames,
  );
  assert.ok(item);
  assert.match(item!.title, /PORX left/);
});

test('buildJoinNameIndex maps steamId to latest join name', () => {
  const index = buildJoinNameIndex([
    entry('player_join', { name: 'Alice', steamId: '76561199150078952' }),
    entry('player_join', { name: 'Bob', steamId: '76561199150078953' }),
  ]);
  assert.equal(index.get('76561199150078952'), 'Alice');
  assert.equal(index.get('76561199150078953'), 'Bob');
});

test('upsertUniquePlayerJoin dedupes reconnects by steamId', () => {
  const map = new Map();
  const base = entry('player_join', {
    name: 'Grego',
    steamId: '76561199150078952',
    carModel: 'ks_toyota_gt86',
  });
  upsertUniquePlayerJoin(map, base, base.payload.data ?? {});
  const later = entry(
    'player_join',
    { name: 'Grego', steamId: '76561199150078952', carModel: 'ks_toyota_gt86' },
    { streamId: '1700000000001-0', ts: 1_700_000_360_000 },
  );
  upsertUniquePlayerJoin(map, later, later.payload.data ?? {});
  assert.equal(map.size, 1);
  assert.equal(map.get('76561199150078952')!.firstJoinTs, 1_700_000_000_000);
});

test('normalizeStreamEntry maps lap PB', () => {
  const item = normalizeStreamEntry(
    entry('lap_completed', {
      name: 'Minty',
      lapTime: 207_443,
      isPersonalBest: true,
      trackName: 'pk_akina',
    }),
  );
  assert.ok(item);
  assert.equal(item!.kind, 'pb');
  assert.match(item!.title, /new PB/);
  assert.match(item!.detail, /3:27.443/);
});

test('normalizeStreamEntry maps battle_finished', () => {
  const item = normalizeStreamEntry(
    entry('battle_finished', {
      player1Name: 'Alice',
      player2Name: 'Bob',
      player1Score: 3,
      player2Score: 2,
      winnerSteamId: 'p1',
      player1SteamId: 'p1',
      player2SteamId: 'p2',
    }),
  );
  assert.ok(item);
  assert.equal(item!.category, 'battles');
  assert.match(item!.title, /Alice wins/);
});

test('matchesCategory excludes sessions from all', () => {
  const sessionItem = normalizeStreamEntry(
    entry('player_join', { name: 'A', steamId: '1' }),
  )!;
  assert.equal(matchesCategory(sessionItem, 'all'), true);

  const fakeSession = {
    ...sessionItem,
    category: 'sessions' as const,
    kind: 'session' as const,
  };
  assert.equal(matchesCategory(fakeSession, 'all'), false);
});

test('matchesServer compares display names loosely', () => {
  const item = normalizeStreamEntry(
    entry('player_join', { name: 'Grego', steamId: '1' }, { serverName: 'Main Touge ℹ18081' }),
  )!;
  assert.equal(matchesServer(item, 'Main Touge'), true);
});

test('matchesServer resolves folder id to ini display name', () => {
  const item = normalizeStreamEntry(
    entry('lap_completed', { name: 'Minty', lapTime: 120_000, trackName: 'pk_akina' }, { serverName: 'Porx' }),
  )!;
  // Folder slug from summarizeServers() should match Redis display serverName when INI NAME matches.
  const servers = summarizeServers();
  const porx = servers.find((s) => s.displayName?.toLowerCase() === 'porx');
  if (!porx) {
    return;
  }
  assert.equal(matchesServer(item, porx.name), true);
});
