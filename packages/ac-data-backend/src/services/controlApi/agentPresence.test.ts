import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGENT_PRESENCE_TTL_SEC, instanceAgentKey } from './redisKeys.js';

describe('agentPresence redis keys', () => {
  it('builds instance agent key', () => {
    assert.equal(instanceAgentKey('vps-eu-2'), 'instance:vps-eu-2:agent');
  });

  it('has a positive TTL default', () => {
    assert.ok(AGENT_PRESENCE_TTL_SEC >= 30);
  });
});
