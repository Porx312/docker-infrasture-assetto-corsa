import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBoardCacheKey,
  buildPlayerCacheKey,
  buildSessionCacheKey,
  normalizeHudKeyPart,
  parsePresenceRosterKeySuffix,
  playerRedisKey,
  presenceRedisKey,
  presenceRosterRedisKey,
  sessionRedisKey,
  connPresenceRedisKey,
  ssePresenceRedisKey,
} from './hudCacheKeys.js';
import { HUD_PRESENCE_TTL_DEFAULT_SEC } from './hudTtl.js';
import { httpsToWss } from './hudWsUrl.js';
import { parseHudPresenceRecordJson, serializeHudPresenceRecord } from './hudPresenceRecord.js';

test('normalizeHudKeyPart lowercases and replaces spaces', () => {
  assert.equal(normalizeHudKeyPart('Project D'), 'project_d');
});

test('buildBoardCacheKey matches board scope formula', () => {
  assert.equal(
    buildBoardCacheKey({ serverName: 'Project D', track: 'pk_akina', trackConfig: 'downhill' }),
    'project_d@pk_akina@downhill@global',
  );
});

test('player/session redis keys', () => {
  assert.equal(buildPlayerCacheKey({ steamId: '1' }), '1');
  assert.equal(buildSessionCacheKey({ steamId: '1' }), '1');
  assert.equal(playerRedisKey('1'), 'ac:hud:player:1');
  assert.equal(sessionRedisKey('1'), 'ac:hud:session:1');
  assert.equal(presenceRedisKey('1'), 'ac:hud:presence:1');
  assert.equal(connPresenceRedisKey('1'), 'ac:hud:conn:1');
  assert.equal(ssePresenceRedisKey('1'), 'ac:hud:sse:1');
});

test('presence roster key scoped by instance', () => {
  assert.equal(
    presenceRosterRedisKey('lobby_a', 'vps-eu-2'),
    'ac:hud:presence:roster:vps-eu-2:lobby_a',
  );
  assert.deepEqual(parsePresenceRosterKeySuffix('vps-eu-2:lobby_a'), {
    instanceId: 'vps-eu-2',
    serverId: 'lobby_a',
  });
});

test('httpsToWss converts schemes', () => {
  assert.equal(httpsToWss('https://eu.example.com'), 'wss://eu.example.com');
  assert.equal(httpsToWss('http://10.0.0.2:3000'), 'ws://10.0.0.2:3000');
});

test('presence TTL default exceeds telemetry heartbeat 300s', () => {
  assert.ok(HUD_PRESENCE_TTL_DEFAULT_SEC > 300);
});

test('presence record round-trip', () => {
  const json = serializeHudPresenceRecord({
    serverName: 'Lobby',
    track: 'ks_nord',
    trackConfig: '',
    carModel: 'ks_toyota',
    updatedAt: 1,
    instanceId: 'vps-eu-2',
    folderSlug: 'server-1',
  });
  const parsed = parseHudPresenceRecordJson(json);
  assert.ok(parsed);
  assert.equal(parsed?.instanceId, 'vps-eu-2');
  assert.equal(parsed?.folderSlug, 'server-1');
});
