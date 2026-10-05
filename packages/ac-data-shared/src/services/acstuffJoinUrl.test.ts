import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAcstuffJoinUrl, joinIpFromBaseUrl } from './acstuffJoinUrl.js';

describe('acstuffJoinUrl', () => {
  it('extracts public hostname from baseUrl', () => {
    assert.equal(joinIpFromBaseUrl('http://13.140.160.131:3000'), '13.140.160.131');
    assert.equal(joinIpFromBaseUrl('https://edge.example.com/'), 'edge.example.com');
  });

  it('rejects localhost and private hosts', () => {
    assert.equal(joinIpFromBaseUrl('http://127.0.0.1:3000'), null);
    assert.equal(joinIpFromBaseUrl('http://localhost:3000'), null);
    assert.equal(joinIpFromBaseUrl('http://10.0.0.2:3000'), null);
    assert.equal(joinIpFromBaseUrl('http://192.168.1.5:3000'), null);
    assert.equal(joinIpFromBaseUrl('http://172.16.0.1:3000'), null);
  });

  it('builds acstuff join URL', () => {
    assert.equal(
      buildAcstuffJoinUrl('13.140.160.131', 8086),
      'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8086',
    );
  });

  it('returns null without usable ip or port', () => {
    assert.equal(buildAcstuffJoinUrl('10.0.0.2', 8081), null);
    assert.equal(buildAcstuffJoinUrl('13.140.160.131', 0), null);
    assert.equal(buildAcstuffJoinUrl('', 8081), null);
    assert.equal(buildAcstuffJoinUrl('13.140.160.131', null), null);
  });
});
