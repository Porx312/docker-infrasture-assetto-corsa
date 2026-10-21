import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyCspMinTrackForIni,
  formatCspMinTrack,
  resolveCspMinBuild,
  stripCspTrackPrefix,
} from '../../src/mods/cspTrack.js';

describe('stripCspTrackPrefix', () => {
  it('strips simple csp/BUILD/../slug', () => {
    assert.equal(stripCspTrackPrefix('csp/2735/../akina'), 'akina');
    assert.equal(stripCspTrackPrefix('CSP/2735/../hakone_ohiradai_v3'), 'hakone_ohiradai_v3');
  });

  it('strips csp/BUILD/../opts/../slug', () => {
    assert.equal(stripCspTrackPrefix('csp/2735/../D/../akina'), 'akina');
    assert.equal(stripCspTrackPrefix('csp/2053/../H/../shuto_revival_project_beta'), 'shuto_revival_project_beta');
  });

  it('leaves plain slugs unchanged', () => {
    assert.equal(stripCspTrackPrefix('akina'), 'akina');
    assert.equal(stripCspTrackPrefix('  monza  '), 'monza');
  });
});

describe('formatCspMinTrack', () => {
  it('wraps slug when build > 0', () => {
    assert.equal(formatCspMinTrack('akina', 2735), 'csp/2735/../akina');
  });

  it('strips existing wrapper before re-wrapping', () => {
    assert.equal(formatCspMinTrack('csp/2000/../akina', 2735), 'csp/2735/../akina');
    assert.equal(formatCspMinTrack('csp/2000/../D/../akina', 2735), 'csp/2735/../akina');
  });

  it('returns plain slug when build <= 0', () => {
    assert.equal(formatCspMinTrack('csp/2735/../akina', 0), 'akina');
    assert.equal(formatCspMinTrack('akina', -1), 'akina');
  });

  it('round-trips with strip', () => {
    const wrapped = formatCspMinTrack('hakone_ohiradai_v3', 2735);
    assert.equal(stripCspTrackPrefix(wrapped), 'hakone_ohiradai_v3');
  });
});

describe('resolveCspMinBuild', () => {
  it('defaults to 2735 when unset', () => {
    assert.equal(resolveCspMinBuild({}), 2735);
  });

  it('returns 0 for off/false/0', () => {
    assert.equal(resolveCspMinBuild({ AC_CSP_MIN_BUILD: '0' }), 0);
    assert.equal(resolveCspMinBuild({ AC_CSP_MIN_BUILD: 'off' }), 0);
    assert.equal(resolveCspMinBuild({ AC_CSP_MIN_BUILD: 'false' }), 0);
  });

  it('parses positive build', () => {
    assert.equal(resolveCspMinBuild({ AC_CSP_MIN_BUILD: '3465' }), 3465);
  });
});

describe('applyCspMinTrackForIni', () => {
  it('uses env build', () => {
    const prev = process.env.AC_CSP_MIN_BUILD;
    try {
      process.env.AC_CSP_MIN_BUILD = '2735';
      assert.equal(applyCspMinTrackForIni('akina'), 'csp/2735/../akina');
      process.env.AC_CSP_MIN_BUILD = '0';
      assert.equal(applyCspMinTrackForIni('csp/2735/../akina'), 'akina');
    } finally {
      if (prev === undefined) delete process.env.AC_CSP_MIN_BUILD;
      else process.env.AC_CSP_MIN_BUILD = prev;
    }
  });
});
