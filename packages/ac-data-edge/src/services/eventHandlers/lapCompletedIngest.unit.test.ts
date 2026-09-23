import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setSaveTimeReaderForTests,
  shouldSkipLapCompletedIngest,
} from './lapCompleted.js';

test.afterEach(() => {
  setSaveTimeReaderForTests(null);
});

test('shouldSkipLapCompletedIngest is false when saveTime enabled (mock, no Redis)', async () => {
  setSaveTimeReaderForTests(async () => true);

  const skip = await shouldSkipLapCompletedIngest({
    event: 'lap_completed',
    data: { steamId: '76561199000000777', lapTime: 95_000 },
  });
  assert.equal(skip, false);
});

test('shouldSkipLapCompletedIngest is true when saveTime disabled (mock, no Redis)', async () => {
  setSaveTimeReaderForTests(async () => false);

  const skip = await shouldSkipLapCompletedIngest({
    event: 'lap_completed',
    data: { steamId: '76561199000000777', lapTime: 95_000 },
  });
  assert.equal(skip, true);
});

test('shouldSkipLapCompletedIngest is false when payload lacks steamId', async () => {
  setSaveTimeReaderForTests(async () => false);

  const skip = await shouldSkipLapCompletedIngest({
    event: 'lap_completed',
    data: { lapTime: 95_000 },
  });
  assert.equal(skip, false);
});
