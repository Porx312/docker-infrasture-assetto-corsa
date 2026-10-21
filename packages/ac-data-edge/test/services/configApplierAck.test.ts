import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configDlqSeenKey,
  configFailKey,
  incrFailCountOnceTtl,
  processConfigApplyOutcome,
  type ConfigAckRedis,
} from '../../src/services/configApplierAck.js';

function memoryRedis(opts?: { failDlq?: boolean; failAckAfterDlq?: boolean }): ConfigAckRedis & {
  store: Map<string, { n?: number; ttl?: number; stream: Array<Record<string, string>>; nx?: string }>;
  acks: string[];
} {
  const store = new Map<
    string,
    { n?: number; ttl?: number; stream: Array<Record<string, string>>; nx?: string }
  >();
  const acks: string[] = [];
  return {
    store,
    acks,
    async incr(key) {
      const row = store.get(key) ?? { stream: [] };
      row.n = (row.n ?? 0) + 1;
      store.set(key, row);
      return row.n;
    },
    async ttl(key) {
      const row = store.get(key);
      if (!row || row.n === undefined) return -2;
      if (row.ttl === undefined) return -1;
      return row.ttl;
    },
    async expire(key, seconds) {
      const row = store.get(key) ?? { stream: [] };
      row.ttl = seconds;
      store.set(key, row);
    },
    async del(key) {
      store.delete(key);
    },
    async setNx(key, value, ttlSec) {
      const row = store.get(key);
      if (row?.nx) return false;
      store.set(key, { stream: [], nx: value, ttl: ttlSec });
      return true;
    },
    async xAdd(key, _id, message) {
      if (opts?.failDlq) throw new Error('dlq_xadd_failed');
      const row = store.get(key) ?? { stream: [] };
      row.stream.push(message);
      store.set(key, row);
      return `dlq-${row.stream.length}`;
    },
    async xAck(_stream, _group, id) {
      if (opts?.failAckAfterDlq) throw new Error('xack_crashed');
      acks.push(id);
    },
  };
}

test('A: applyOk → ACK, no DLQ', async () => {
  const redis = memoryRedis();
  const out = await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '1-0',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: null,
    applyOk: true,
  });
  assert.equal(out.acked, true);
  assert.equal(out.decision.action, 'ack');
  assert.deepEqual(redis.acks, ['1-0']);
  assert.equal(redis.store.get('ac:config:dlq')?.stream.length ?? 0, 0);
});

test('B: fail below max → nack, counter++, TTL once', async () => {
  const redis = memoryRedis();
  const key = configFailKey('vps', '1-1');
  const out1 = await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '1-1',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: 'boom',
    applyOk: false,
    maxFailures: 3,
  });
  assert.equal(out1.acked, false);
  assert.equal(out1.decision.action, 'nack');
  assert.equal(out1.failCount, 1);
  assert.equal(await redis.ttl(key), 86_400);
  const out2 = await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '1-1',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: 'boom',
    applyOk: false,
    maxFailures: 3,
  });
  assert.equal(out2.failCount, 2);
  assert.equal(await redis.ttl(key), 86_400);
  assert.deepEqual(redis.acks, []);
});

test('F: incrFailCountOnceTtl sets TTL only once', async () => {
  const redis = memoryRedis();
  const key = configFailKey('vps', 'f-0');
  assert.equal(await incrFailCountOnceTtl(redis, key, 100), 1);
  assert.equal(await redis.ttl(key), 100);
  assert.equal(await incrFailCountOnceTtl(redis, key, 999), 2);
  assert.equal(await redis.ttl(key), 100);
});

test('C: at threshold → DLQ with originalMsgId then ACK + clear counter', async () => {
  const redis = memoryRedis();
  for (let i = 0; i < 4; i++) {
    await processConfigApplyOutcome({
      redis,
      streamKey: 'ac:config',
      group: 'g',
      msgId: '2-0',
      instanceId: 'vps',
      payloadJson: '{"event":"server_config_snapshot"}',
      applyError: 'fail',
      applyOk: false,
      maxFailures: 5,
    });
  }
  const out = await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '2-0',
    instanceId: 'vps',
    payloadJson: '{"event":"server_config_snapshot"}',
    applyError: 'fail',
    applyOk: false,
    maxFailures: 5,
  });
  assert.equal(out.acked, true);
  assert.equal(out.decision.action, 'dlq_then_ack');
  assert.ok(out.dlqId);
  const dlq = redis.store.get('ac:config:dlq');
  assert.equal(dlq?.stream.length, 1);
  assert.equal(dlq?.stream[0]?.originalMsgId, '2-0');
  assert.equal(dlq?.stream[0]?.instanceId, 'vps');
  assert.ok(dlq?.stream[0]?.error);
  assert.ok(dlq?.stream[0]?.ts);
  assert.deepEqual(redis.acks, ['2-0']);
  assert.equal(redis.store.has(configFailKey('vps', '2-0')), false);
});

test('D: DLQ XADD failure → no ACK (acked false)', async () => {
  const redis = memoryRedis({ failDlq: true });
  const out = await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '3-0',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: 'x',
    applyOk: false,
    maxFailures: 1,
  });
  assert.equal(out.acked, false);
  assert.equal(out.decision.action, 'dlq_failed');
  assert.deepEqual(redis.acks, []);
});

test('E: crash after DLQ before ACK leaves acks empty; retry can duplicate DLQ without setNx', async () => {
  const redisNoNx: ConfigAckRedis & {
    store: Map<string, { stream: Array<Record<string, string>>; n?: number; ttl?: number }>;
    acks: string[];
  } = {
    store: new Map(),
    acks: [],
    async incr(key) {
      const row = this.store.get(key) ?? { stream: [] };
      row.n = (row.n ?? 0) + 1;
      this.store.set(key, row);
      return row.n!;
    },
    async ttl(key) {
      const row = this.store.get(key);
      if (!row?.n) return -2;
      return row.ttl ?? -1;
    },
    async expire(key, seconds) {
      const row = this.store.get(key) ?? { stream: [] };
      row.ttl = seconds;
      this.store.set(key, row);
    },
    async del(key) {
      this.store.delete(key);
    },
    async xAdd(key, _id, message) {
      const row = this.store.get(key) ?? { stream: [] };
      row.stream.push(message);
      this.store.set(key, row);
      return `dlq-${row.stream.length}`;
    },
    async xAck() {
      throw new Error('crash_before_ack');
    },
  };

  await assert.rejects(
    () =>
      processConfigApplyOutcome({
        redis: redisNoNx,
        streamKey: 'ac:config',
        group: 'g',
        msgId: '4-0',
        instanceId: 'vps',
        payloadJson: '{}',
        applyError: 'x',
        applyOk: false,
        maxFailures: 1,
      }),
    /crash_before_ack/,
  );
  assert.equal(redisNoNx.store.get('ac:config:dlq')?.stream.length, 1);
  assert.deepEqual(redisNoNx.acks, []);

  // Simulate reclaim: counter still high, no setNx → second DLQ entry (at-least-once).
  redisNoNx.xAck = async (_s, _g, id) => {
    redisNoNx.acks.push(id);
  };
  await processConfigApplyOutcome({
    redis: redisNoNx,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '4-0',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: 'x',
    applyOk: false,
    maxFailures: 1,
  });
  assert.equal(redisNoNx.store.get('ac:config:dlq')?.stream.length, 2);
  assert.equal(redisNoNx.store.get('ac:config:dlq')?.stream[0]?.originalMsgId, '4-0');
  assert.equal(redisNoNx.store.get('ac:config:dlq')?.stream[1]?.originalMsgId, '4-0');
});

test('E2: setNx prevents second DLQ write for same originalMsgId', async () => {
  const redis = memoryRedis();
  await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '5-0',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: 'x',
    applyOk: false,
    maxFailures: 1,
  });
  assert.equal(redis.store.get('ac:config:dlq')?.stream.length, 1);
  const again = await processConfigApplyOutcome({
    redis,
    streamKey: 'ac:config',
    group: 'g',
    msgId: '5-0',
    instanceId: 'vps',
    payloadJson: '{}',
    applyError: 'x',
    applyOk: false,
    maxFailures: 1,
  });
  assert.equal(again.acked, true);
  assert.equal(redis.store.get('ac:config:dlq')?.stream.length, 1);
  assert.ok(redis.store.get(configDlqSeenKey('5-0'))?.nx);
});
