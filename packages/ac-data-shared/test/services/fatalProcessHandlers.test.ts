import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { installFatalProcessHandlers } from '../../src/services/fatalProcessHandlers.js';

test('uncaughtException logs and exits with code 1', () => {
  const fake = new EventEmitter() as NodeJS.Process;
  const exits: number[] = [];
  const logs: unknown[][] = [];

  const originalOn = process.on.bind(process);
  const originalProcessOn = process.on;
  // Install against real process but capture exit; use isolated emitter via monkeypatch
  let uncaughtHandler: ((err: Error) => void) | undefined;
  (process as NodeJS.Process).on = ((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'uncaughtException') {
      uncaughtHandler = handler as (err: Error) => void;
      return process;
    }
    if (event === 'unhandledRejection') {
      return process;
    }
    return originalOn(event as never, handler as never);
  }) as typeof process.on;

  try {
    installFatalProcessHandlers({
      serviceName: 'test-svc',
      exit: (code) => {
        exits.push(code);
      },
      log: (...args) => {
        logs.push(args);
      },
    });
    assert.ok(uncaughtHandler);
    uncaughtHandler!(new Error('boom'));
    assert.deepEqual(exits, [1]);
    assert.ok(String(logs[0]?.[0] ?? '').includes('uncaughtException'));
  } finally {
    process.on = originalProcessOn;
  }

  void fake;
});

test('unhandledRejection does not exit by default', () => {
  let rejectionHandler: ((reason: unknown) => void) | undefined;
  const originalProcessOn = process.on;
  (process as NodeJS.Process).on = ((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'unhandledRejection') {
      rejectionHandler = handler as (reason: unknown) => void;
      return process;
    }
    if (event === 'uncaughtException') {
      return process;
    }
    return originalProcessOn(event as never, handler as never);
  }) as typeof process.on;

  const exits: number[] = [];
  try {
    installFatalProcessHandlers({
      serviceName: 'test-svc',
      exit: (code) => {
        exits.push(code);
      },
      log: () => {},
    });
    assert.ok(rejectionHandler);
    rejectionHandler!('soft');
    assert.deepEqual(exits, []);
  } finally {
    process.on = originalProcessOn;
  }
});

test('unhandledRejection exits when fatalUnhandledRejection true', () => {
  let rejectionHandler: ((reason: unknown) => void) | undefined;
  const originalProcessOn = process.on;
  (process as NodeJS.Process).on = ((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'unhandledRejection') {
      rejectionHandler = handler as (reason: unknown) => void;
      return process;
    }
    if (event === 'uncaughtException') {
      return process;
    }
    return originalProcessOn(event as never, handler as never);
  }) as typeof process.on;

  const exits: number[] = [];
  try {
    installFatalProcessHandlers({
      serviceName: 'test-svc',
      fatalUnhandledRejection: true,
      exit: (code) => {
        exits.push(code);
      },
      log: () => {},
    });
    rejectionHandler!('hard');
    assert.deepEqual(exits, [1]);
  } finally {
    process.on = originalProcessOn;
  }
});
