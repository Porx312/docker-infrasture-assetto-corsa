/**
 * Keep public/js/lib/serverSlimPaths.js in sync with ac-data-shared.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isServerSlimRelativePath as shared } from '@projectd/ac-data-shared/mods/serverSlimPaths.js';
import { isServerSlimRelativePath as browser } from '../../../public/js/lib/serverSlimPaths.js';

const CASES: Array<{ rel: string; kind: 'car' | 'track'; want: boolean }> = [
  { rel: 'data.acd', kind: 'car', want: true },
  { rel: 'data/car.ini', kind: 'car', want: true },
  { rel: 'ui/ui_car.json', kind: 'car', want: true },
  { rel: 'skins/red/ui_skin.json', kind: 'car', want: true },
  { rel: 'skins/red/preview.jpg', kind: 'car', want: true },
  { rel: 'skins/red/body.kn5', kind: 'car', want: false },
  { rel: 'skins/red/livery.dds', kind: 'car', want: false },
  { rel: 'models.ini', kind: 'track', want: true },
  { rel: 'data/surfaces.ini', kind: 'track', want: true },
  { rel: 'layout_a/data/surfaces.ini', kind: 'track', want: true },
  { rel: 'ui/ui_track.json', kind: 'track', want: true },
  { rel: 'map.png', kind: 'track', want: false },
  { rel: '../escape', kind: 'car', want: false },
];

describe('serverSlimPaths browser mirror parity', () => {
  for (const c of CASES) {
    it(`${c.kind}:${c.rel} → ${c.want}`, () => {
      assert.equal(shared(c.rel, c.kind), c.want);
      assert.equal(browser(c.rel, c.kind), c.want);
      assert.equal(browser(c.rel, c.kind), shared(c.rel, c.kind));
    });
  }
});
