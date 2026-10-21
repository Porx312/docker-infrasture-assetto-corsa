import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGENT_PRESENCE_TTL_SEC, instanceAgentKey } from '../../../src/services/controlApi/redisKeys.js';
import { _normalizeAgentServersForTests } from '../../../src/services/controlApi/agentPresence.js';

describe('agentPresence redis keys', () => {
  it('builds instance agent key', () => {
    assert.equal(instanceAgentKey('vps-eu-2'), 'instance:vps-eu-2:agent');
  });

  it('has a positive TTL default', () => {
    assert.ok(AGENT_PRESENCE_TTL_SEC >= 30);
  });
});

describe('agentPresence lifecycle normalize', () => {
  it('maps ONLINE/FAILED/intermediate phases onto status', () => {
    const slots = _normalizeAgentServersForTests([
      { name: 'a', status: 'idle', phase: 'ONLINE', phaseUpdatedAt: 1 },
      { name: 'b', status: 'idle', phase: 'FAILED', phaseDetail: 'timeout', phaseUpdatedAt: 2 },
      { name: 'c', status: 'live', phase: 'PREPARING', phaseUpdatedAt: 3 },
    ]);
    assert.equal(slots[0]?.status, 'live');
    assert.equal(slots[0]?.phase, 'ONLINE');
    assert.equal(slots[1]?.status, 'error');
    assert.equal(slots[1]?.phaseDetail, 'timeout');
    assert.equal(slots[2]?.status, 'starting');
    assert.equal(slots[2]?.phase, 'PREPARING');
  });

  it('ignores invalid phase and keeps legacy status', () => {
    const slots = _normalizeAgentServersForTests([
      { name: 'x', status: 'idle', phase: 'NOPE', phaseUpdatedAt: -1 },
    ]);
    assert.equal(slots[0]?.status, 'idle');
    assert.equal(slots[0]?.phase, undefined);
  });

  it('truncates oversized phaseDetail', () => {
    const slots = _normalizeAgentServersForTests([
      {
        name: 'y',
        phase: 'CHECKING',
        phaseDetail: 'z'.repeat(300),
        phaseUpdatedAt: 10,
      },
    ]);
    assert.equal(slots[0]?.phaseDetail?.length, 240);
  });
});
