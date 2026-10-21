import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIngestEvent, normalizeIngestTrackFields } from '../../src/services/ingestEventBuilder.js';

describe('normalizeIngestTrackFields', () => {
  it('strips csp/3465/../sakanotsuji from trackName', () => {
    const out = normalizeIngestTrackFields({
      trackName: 'csp/3465/../sakanotsuji',
      lapTime: 120_000,
    });
    assert.equal(out.trackName, 'sakanotsuji');
    assert.equal(out.lapTime, 120_000);
  });

  it('strips track alias and opts form', () => {
    const out = normalizeIngestTrackFields({
      track: 'csp/2735/../D/../pk_akina',
    });
    assert.equal(out.track, 'pk_akina');
  });

  it('leaves plain slug unchanged', () => {
    const out = normalizeIngestTrackFields({ trackName: 'sakanotsuji' });
    assert.equal(out.trackName, 'sakanotsuji');
  });
});

describe('buildIngestEvent', () => {
  it('strips CSP trackName on lap_completed for Convex', () => {
    const built = buildIngestEvent(
      {
        event: 'lap_completed',
        serverName: 'projectd',
        eventId: 'e1',
        data: {
          steamId: '76561199000000001',
          trackName: 'csp/3465/../sakanotsuji',
          trackConfig: 'downhill',
          lapTime: 99_000,
        },
      },
      (s) => s,
    );
    assert.equal(built.eventType, 'lap_completed');
    assert.equal((built.data as { trackName: string }).trackName, 'sakanotsuji');
    assert.equal((built.data as { trackConfig: string }).trackConfig, 'downhill');
  });
});
