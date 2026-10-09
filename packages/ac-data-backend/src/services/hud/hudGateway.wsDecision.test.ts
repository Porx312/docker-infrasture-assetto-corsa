import assert from 'node:assert/strict';
import test from 'node:test';

import { decideHudGatewayWsUpgrade } from './hudGateway.js';

test('decideHudGatewayWsUpgrade rejects missing steamId', () => {
  const decision = decideHudGatewayWsUpgrade({
    steamId: null,
    routing: { ok: false, reason: 'player_not_connected' },
    searchParams: new URLSearchParams('api_key=x'),
  });
  assert.equal(decision.action, 'reject');
  if (decision.action === 'reject') {
    assert.equal(decision.statusCode, 400);
  }
});

test('decideHudGatewayWsUpgrade rejects redis_unavailable with 503', () => {
  const decision = decideHudGatewayWsUpgrade({
    steamId: '76561199000000001',
    routing: { ok: false, reason: 'redis_unavailable' },
    searchParams: new URLSearchParams(),
  });
  assert.equal(decision.action, 'reject');
  if (decision.action === 'reject') {
    assert.equal(decision.statusCode, 503);
    assert.equal(decision.message, 'redis_unavailable');
  }
});

test('decideHudGatewayWsUpgrade rejects edge_not_registered with 404', () => {
  const decision = decideHudGatewayWsUpgrade({
    steamId: '76561199000000001',
    routing: { ok: false, reason: 'edge_not_registered', serverName: 'Lobby' },
    searchParams: new URLSearchParams(),
  });
  assert.equal(decision.action, 'reject');
  if (decision.action === 'reject') {
    assert.equal(decision.statusCode, 404);
  }
});

test('decideHudGatewayWsUpgrade builds upstream WSS URL', () => {
  const decision = decideHudGatewayWsUpgrade({
    steamId: '76561199000000001',
    routing: {
      ok: true,
      steamId: '76561199000000001',
      presence: {
        serverName: 'EU Lobby',
        track: '',
        trackConfig: '',
        carModel: '',
        updatedAt: 1,
        instanceId: 'vps-eu-2',
      },
      edge: {
        baseUrl: 'http://10.0.0.2:3000',
        publicBaseUrl: 'https://eu.example.com',
        instanceId: 'vps-eu-2',
        source: 'dynamic',
      },
      publicBaseUrl: 'https://eu.example.com',
    },
    searchParams: new URLSearchParams('steamId=76561199000000001&api_key=k'),
  });
  assert.equal(decision.action, 'proxy');
  if (decision.action === 'proxy') {
    assert.equal(
      decision.upstreamUrl,
      'ws://10.0.0.2:3000/hud/ws?steamId=76561199000000001&api_key=k',
    );
    assert.equal(decision.serverName, 'EU Lobby');
  }
});
