/**
 * Isolated Redis Streams integration for config ACK / DLQ (cases A–G).
 *
 * Only runs against an ephemeral test Redis — never shared/prod.
 *
 * Env (preferred):
 *   REDIS_TEST_HOST=127.0.0.1 REDIS_TEST_PORT=16379
 * Fallback (still isolated only if you point at a disposable instance):
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=16379
 *
 * Skip unless test host is set and SKIP_REDIS_INTEGRATION is not 1.
 *
 * Staging / local ephemeral:
 *   bash scripts/redis-test-up.sh
 *   REDIS_TEST_HOST=127.0.0.1 REDIS_TEST_PORT=16379 SKIP_REDIS_INTEGRATION=0 \
 *     npm run test:integration -w @projectd/ac-data-edge
 *   bash scripts/redis-test-down.sh
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const testHost = (process.env.REDIS_TEST_HOST || process.env.REDIS_HOST || '').trim();
const testPort = Number(process.env.REDIS_TEST_PORT || process.env.REDIS_PORT || 16379);
const skip =
  !testHost ||
  process.env.SKIP_REDIS_INTEGRATION === '1' ||
  // Refuse default prod port unless REDIS_TEST_* is explicitly set
  (process.env.REDIS_TEST_HOST === undefined &&
    process.env.REDIS_HOST !== undefined &&
    testPort === 6379 &&
    process.env.ALLOW_REDIS_INTEGRATION_ON_6379 !== '1');

const skipMsg =
  'BLOCKED: need isolated Redis; run: bash scripts/redis-test-up.sh && ' +
  'REDIS_TEST_HOST=127.0.0.1 REDIS_TEST_PORT=16379 SKIP_REDIS_INTEGRATION=0 ' +
  'npm run test:integration -w @projectd/ac-data-edge';

async function pendingCount(
  client: { xPending: (stream: string, group: string) => Promise<unknown> },
  stream: string,
  group: string,
): Promise<number> {
  const pending = await client.xPending(stream, group);
  if (!pending || typeof pending !== 'object') return -1;
  const row = pending as { pending?: number; count?: number };
  if (typeof row.pending === 'number') return row.pending;
  if (typeof row.count === 'number') return row.count;
  return -1;
}

test(
  'integration A–G: ACK/DLQ/PEL/reclaim against isolated Redis',
  { skip: skip ? skipMsg : false },
  async () => {
    const { createClient } = await import('redis');
    const {
      processConfigApplyOutcome,
      configFailKey,
      configDlqSeenKey,
    } = await import('../../src/services/configApplierAck.js');

    const client = createClient({
      socket: {
        host: testHost,
        port: testPort,
      },
      password: process.env.REDIS_TEST_PASSWORD || process.env.REDIS_PASSWORD || undefined,
    });
    await client.connect();

    const prefix = `ac:config:test:${Date.now()}`;
    const stream = `${prefix}:stream`;
    const dlqStream = `${prefix}:dlq`;
    const group = `g-test-${Date.now()}`;
    const keysToClean: string[] = [stream, dlqStream];

    const ackRedis = {
      incr: (key: string) => {
        keysToClean.push(key);
        return client.incr(key);
      },
      ttl: (key: string) => client.ttl(key),
      expire: (key: string, seconds: number) => client.expire(key, seconds),
      del: (key: string) => client.del(key),
      setNx: async (key: string, value: string, ttlSec: number) => {
        keysToClean.push(key);
        const result = await client.set(key, value, { NX: true, EX: ttlSec });
        return result === 'OK';
      },
      xAdd: (key: string, xid: string, message: Record<string, string>) =>
        client.xAdd(key, xid, message),
      xAck: (s: string, g: string, mid: string) => client.xAck(s, g, mid),
    };

    try {
      await client.xGroupCreate(stream, group, '0', { MKSTREAM: true });

      // --- A: applyOk → ACK, XPENDING empty ---
      {
        const id = await client.xAdd(stream, '*', { payload: '{"event":"server_config_snapshot"}' });
        await client.xReadGroup(group, 'c1', { key: stream, id: '>' }, { COUNT: 1 });
        const out = await processConfigApplyOutcome({
          redis: ackRedis,
          streamKey: stream,
          group,
          msgId: id,
          instanceId: 'test-vps',
          payloadJson: '{}',
          applyError: null,
          applyOk: true,
          dlqStreamKey: dlqStream,
        });
        assert.equal(out.acked, true);
        assert.equal(await pendingCount(client, stream, group), 0);
      }

      // --- B: fail < max → nack leaves PEL ---
      {
        const id = await client.xAdd(stream, '*', { payload: '{}' });
        await client.xReadGroup(group, 'c1', { key: stream, id: '>' }, { COUNT: 1 });
        const out = await processConfigApplyOutcome({
          redis: ackRedis,
          streamKey: stream,
          group,
          msgId: id,
          instanceId: 'test-vps',
          payloadJson: '{}',
          applyError: 'boom',
          applyOk: false,
          maxFailures: 3,
          failTtlSec: 3600,
          dlqStreamKey: dlqStream,
        });
        assert.equal(out.acked, false);
        assert.equal(out.decision.action, 'nack');
        assert.ok((await pendingCount(client, stream, group)) >= 1);
        // cleanup this PEL entry for later cases
        await client.xAck(stream, group, id);
        await client.del(configFailKey('test-vps', id));
      }

      // --- C: at max → DLQ then ACK; D covered by unit (xAdd throw) ---
      {
        const id = await client.xAdd(stream, '*', { payload: '{"event":"server_config_snapshot"}' });
        await client.xReadGroup(group, 'c1', { key: stream, id: '>' }, { COUNT: 1 });
        for (let i = 0; i < 4; i++) {
          await processConfigApplyOutcome({
            redis: ackRedis,
            streamKey: stream,
            group,
            msgId: id,
            instanceId: 'test-vps',
            payloadJson: '{}',
            applyError: 'x',
            applyOk: false,
            maxFailures: 5,
            failTtlSec: 3600,
            dlqStreamKey: dlqStream,
          });
        }
        const out = await processConfigApplyOutcome({
          redis: ackRedis,
          streamKey: stream,
          group,
          msgId: id,
          instanceId: 'test-vps',
          payloadJson: '{}',
          applyError: 'x',
          applyOk: false,
          maxFailures: 5,
          failTtlSec: 3600,
          dlqStreamKey: dlqStream,
        });
        assert.equal(out.acked, true);
        assert.ok(out.dlqId);
        const dlqLen = await client.xLen(dlqStream);
        assert.ok(dlqLen >= 1);
        const range = await client.xRange(dlqStream, '-', '+');
        const last = range[range.length - 1];
        assert.equal(last?.message?.originalMsgId, id);
        keysToClean.push(configDlqSeenKey(id));
        assert.equal(await pendingCount(client, stream, group), 0);
      }

      // --- F: TTL not renewed on successive INCR ---
      {
        const failKey = configFailKey('test-vps', 'ttl-msg');
        keysToClean.push(failKey);
        await client.incr(failKey);
        await client.expire(failKey, 100);
        const ttl1 = await client.ttl(failKey);
        await client.incr(failKey);
        const ttl2 = await client.ttl(failKey);
        assert.ok(ttl1 > 0 && ttl2 > 0);
        assert.ok(ttl2 <= ttl1);
      }

      // --- G: XAUTOCLAIM reclaim of unacked message ---
      {
        const id = await client.xAdd(stream, '*', { payload: '{"reclaim":"1"}' });
        await client.xReadGroup(group, 'c-stale', { key: stream, id: '>' }, { COUNT: 1 });
        // leave unacked (nack path)
        await processConfigApplyOutcome({
          redis: ackRedis,
          streamKey: stream,
          group,
          msgId: id,
          instanceId: 'test-vps',
          payloadJson: '{}',
          applyError: 'leave',
          applyOk: false,
          maxFailures: 99,
          failTtlSec: 3600,
          dlqStreamKey: dlqStream,
        });
        // idle=0 so claim is immediate in test
        const claimed = await client.xAutoClaim(stream, group, 'c-reclaim', 0, '0-0', {
          COUNT: 10,
        });
        const messages = (claimed?.messages ?? []) as Array<{ id: string } | null>;
        const found = messages.some((m) => m && m.id === id);
        assert.ok(found, 'XAUTOCLAIM should reclaim unacked msg');
        await client.xAck(stream, group, id);
        await client.del(configFailKey('test-vps', id));
      }

      // --- E (partial): setNx prevents second DLQ for same originalMsgId ---
      {
        const id = await client.xAdd(stream, '*', { payload: '{}' });
        await client.xReadGroup(group, 'c1', { key: stream, id: '>' }, { COUNT: 1 });
        const dlqBefore = await client.xLen(dlqStream);
        await processConfigApplyOutcome({
          redis: ackRedis,
          streamKey: stream,
          group,
          msgId: id,
          instanceId: 'test-vps',
          payloadJson: '{}',
          applyError: 'poison',
          applyOk: false,
          maxFailures: 1,
          failTtlSec: 3600,
          dlqStreamKey: dlqStream,
        });
        await processConfigApplyOutcome({
          redis: ackRedis,
          streamKey: stream,
          group,
          msgId: id,
          instanceId: 'test-vps',
          payloadJson: '{}',
          applyError: 'poison',
          applyOk: false,
          maxFailures: 1,
          failTtlSec: 3600,
          dlqStreamKey: dlqStream,
        });
        const dlqAfter = await client.xLen(dlqStream);
        assert.equal(dlqAfter - dlqBefore, 1);
      }
    } finally {
      for (const key of [...new Set(keysToClean)]) {
        await client.del(key).catch(() => undefined);
      }
      await client.quit().catch(() => undefined);
    }
  },
);
