/**
 * Pure helpers for ac:config apply ACK / DLQ policy.
 * DLQ + XACK are not atomic: crash between XADD and XACK can duplicate DLQ entries.
 * Deduplicate ops/consumers by originalMsgId — at-least-once, not exactly-once.
 */

export const CONFIG_DLQ_STREAM_KEY = process.env.REDIS_CONFIG_DLQ_STREAM_KEY || 'ac:config:dlq';

export function configFailKey(instanceId: string, msgId: string): string {
  return `ac:config:fail:${instanceId}:${msgId}`;
}

export function configDlqSeenKey(msgId: string): string {
  return `ac:config:dlq:seen:${msgId}`;
}

export function configApplyMaxFailures(): number {
  const raw = Number(process.env.CONFIG_APPLY_MAX_FAILURES || 5);
  if (!Number.isFinite(raw) || raw < 1) return 5;
  return Math.trunc(raw);
}

export function configFailTtlSec(): number {
  const raw = Number(process.env.CONFIG_APPLY_FAIL_TTL_SEC || 86_400);
  if (!Number.isFinite(raw) || raw < 60) return 86_400;
  return Math.trunc(raw);
}

export type ConfigMessageDecision =
  | { action: 'ack' }
  | { action: 'nack' }
  | { action: 'dlq_then_ack'; reason: string }
  | { action: 'dlq_failed'; reason: string };

/** Minimal Redis surface used by processConfigApplyOutcome. */
export type ConfigAckRedis = {
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Optional: SET key value EX ttl NX — returns true if set. */
  setNx?(key: string, value: string, ttlSec: number): Promise<boolean>;
  xAdd(
    key: string,
    id: string,
    message: Record<string, string>,
  ): Promise<string>;
  xAck(stream: string, group: string, id: string): Promise<unknown>;
};

export async function incrFailCountOnceTtl(
  redis: ConfigAckRedis,
  key: string,
  ttlSec: number,
): Promise<number> {
  const count = await redis.incr(key);
  const ttl = await redis.ttl(key);
  // Only set TTL when missing (-1 / -2) so repeated failures do not refresh the window forever.
  if (ttl < 0) {
    await redis.expire(key, ttlSec);
  }
  return count;
}

export type ProcessConfigApplyInput = {
  redis: ConfigAckRedis;
  streamKey: string;
  group: string;
  msgId: string;
  instanceId: string;
  payloadJson: string;
  applyError: string | null;
  /** When true, apply succeeded — ACK without DLQ. */
  applyOk: boolean;
  maxFailures?: number;
  failTtlSec?: number;
  dlqStreamKey?: string;
};

export type ProcessConfigApplyResult = {
  decision: ConfigMessageDecision;
  failCount?: number;
  dlqId?: string;
  acked: boolean;
};

/**
 * After handleSnapshot attempt: ACK on success; on failure bump Redis counter;
 * at threshold XADD DLQ then ACK; otherwise leave unacked for PEL reclaim.
 * If DLQ XADD fails → acked=false (no XACK). Never treat log-only as recovery.
 */
export async function processConfigApplyOutcome(
  input: ProcessConfigApplyInput,
): Promise<ProcessConfigApplyResult> {
  const maxFailures = input.maxFailures ?? configApplyMaxFailures();
  const failTtlSec = input.failTtlSec ?? configFailTtlSec();
  const dlqKey = input.dlqStreamKey ?? CONFIG_DLQ_STREAM_KEY;

  if (input.applyOk) {
    await input.redis.xAck(input.streamKey, input.group, input.msgId);
    const failKey = configFailKey(input.instanceId, input.msgId);
    await input.redis.del(failKey).catch(() => undefined);
    return { decision: { action: 'ack' }, acked: true };
  }

  const failKey = configFailKey(input.instanceId, input.msgId);
  const failCount = await incrFailCountOnceTtl(input.redis, failKey, failTtlSec);

  if (failCount < maxFailures) {
    return { decision: { action: 'nack' }, failCount, acked: false };
  }

  const reason = input.applyError || 'apply_failed';
  const seenKey = configDlqSeenKey(input.msgId);
  if (input.redis.setNx) {
    const claimed = await input.redis.setNx(seenKey, '1', failTtlSec);
    if (!claimed) {
      // Another worker already wrote (or claimed) DLQ for this originalMsgId — still ACK main.
      await input.redis.xAck(input.streamKey, input.group, input.msgId);
      await input.redis.del(failKey).catch(() => undefined);
      return {
        decision: { action: 'dlq_then_ack', reason: `${reason}|dlq_seen` },
        failCount,
        acked: true,
      };
    }
  }

  let dlqId: string;
  try {
    dlqId = await input.redis.xAdd(dlqKey, '*', {
      originalMsgId: input.msgId,
      instanceId: input.instanceId,
      error: reason.slice(0, 2000),
      payload: input.payloadJson.slice(0, 100_000),
      ts: String(Date.now()),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (input.redis.setNx) {
      await input.redis.del(seenKey).catch(() => undefined);
    }
    return {
      decision: { action: 'dlq_failed', reason: msg },
      failCount,
      acked: false,
    };
  }

  // DLQ persisted — now ACK main (still at-least-once if crash before this line → possible duplicate DLQ).
  await input.redis.xAck(input.streamKey, input.group, input.msgId);
  await input.redis.del(failKey).catch(() => undefined);
  return {
    decision: { action: 'dlq_then_ack', reason },
    failCount,
    dlqId,
    acked: true,
  };
}
