import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createProgressThrottleState,
  shouldEmitProgress,
} from './progressThrottle.js';

describe('shouldEmitProgress', () => {
  it('emits on first pct and on each new integer %', () => {
    const state = createProgressThrottleState();
    const t0 = 1_000_000;
    assert.equal(shouldEmitProgress(state, 0, t0, 500), true);
    assert.equal(shouldEmitProgress(state, 0, t0 + 10, 500), false);
    assert.equal(shouldEmitProgress(state, 1, t0 + 20, 500), true);
    assert.equal(shouldEmitProgress(state, 1, t0 + 30, 500), false);
    assert.equal(shouldEmitProgress(state, 50, t0 + 40, 500), true);
  });

  it('emits again after minInterval even if % unchanged', () => {
    const state = createProgressThrottleState();
    const t0 = 1_000_000;
    assert.equal(shouldEmitProgress(state, 42, t0, 500), true);
    assert.equal(shouldEmitProgress(state, 42, t0 + 100, 500), false);
    assert.equal(shouldEmitProgress(state, 42, t0 + 500, 500), true);
  });

  it('always emits 100 once', () => {
    const state = createProgressThrottleState();
    assert.equal(shouldEmitProgress(state, 99, 0, 500), true);
    assert.equal(shouldEmitProgress(state, 100, 10, 500, true), true);
    assert.equal(shouldEmitProgress(state, 100, 20, 500), false);
  });

  it('2MB with 1KiB chunks does not emit hundreds of times', () => {
    const state = createProgressThrottleState();
    const size = 2 * 1024 * 1024;
    const chunk = 1024;
    let emits = 0;
    let received = 0;
    let now = 1_000_000;
    while (received < size) {
      received += chunk;
      const pct = Math.min(99, Math.round((received / size) * 100));
      now += 1; // fast download: same % re-hit long before 500ms
      if (shouldEmitProgress(state, pct, now, 500)) {
        emits += 1;
      }
    }
    // Without throttle: 2048 emits. With throttle: ~100 (one per integer %).
    assert.ok(emits <= 110, `expected <=110 emits, got ${emits}`);
    assert.ok(emits >= 50, `expected meaningful progress emits, got ${emits}`);
    assert.ok(emits < 500, 'must not enqueue hundreds of POSTs for 2MB');
  });
});

describe('createProgressReporter-compatible gate', () => {
  it('2MB storm enqueues far fewer than one POST per chunk', async () => {
    const posts: number[] = [];
    const throttle = createProgressThrottleState();
    const minMs = 500;
    let chain = Promise.resolve();
    let now = 2_000_000;
    const report = (pct: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      now += 1;
      if (!shouldEmitProgress(throttle, clamped, now, minMs, clamped >= 100)) {
        return chain;
      }
      const value = clamped;
      chain = chain.then(async () => {
        posts.push(value);
      });
      return chain;
    };

    const size = 2 * 1024 * 1024;
    const chunk = 1024;
    let received = 0;
    while (received < size) {
      received += chunk;
      void report(Math.min(99, Math.round((received / size) * 100)));
    }
    void report(100);
    await chain;

    assert.ok(posts.length <= 110, `expected <=110 POSTs, got ${posts.length}`);
    assert.equal(posts[posts.length - 1], 100);
    assert.ok(posts.length < 500, '2MB must not enqueue hundreds of hub progress POSTs');
  });
});
