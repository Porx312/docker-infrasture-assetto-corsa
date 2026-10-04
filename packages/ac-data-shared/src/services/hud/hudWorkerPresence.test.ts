import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hudWorkerPresenceFromRecord,
  readHudWorkerPresenceFromBody,
} from './hudWorkerPresence.js';

describe('hudWorkerPresence', () => {
  it('builds presence from record when serverName set', () => {
    const presence = hudWorkerPresenceFromRecord({
      serverName: 'Battles P',
      instanceId: 'vps-eu-2',
      folderSlug: 'server-4',
      carModel: 'ks_porsche_911_gt3_rs',
      track: 'ks_nordschleife',
      trackConfig: 'touruito',
    });
    assert.deepEqual(presence, {
      serverName: 'Battles P',
      instanceId: 'vps-eu-2',
      folderSlug: 'server-4',
      carModel: 'ks_porsche_911_gt3_rs',
      track: 'ks_nordschleife',
      trackConfig: 'touruito',
    });
  });

  it('returns undefined without serverName', () => {
    assert.equal(hudWorkerPresenceFromRecord({ serverName: '  ' }), undefined);
    assert.equal(hudWorkerPresenceFromRecord({}), undefined);
  });

  it('parses presence from worker body', () => {
    const presence = readHudWorkerPresenceFromBody({
      steamId: '76561199230780195',
      presence: { serverName: 'Battles P', carModel: 'x' },
    });
    assert.deepEqual(presence, { serverName: 'Battles P', carModel: 'x' });
  });
});
