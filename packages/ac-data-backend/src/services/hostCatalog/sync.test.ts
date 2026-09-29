import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractCarSkinsFromZipPaths,
  extractTrackConfigsFromZipPaths,
} from './sync.js';

describe('hostCatalog path helpers', () => {
  it('extracts car skins', () => {
    const skins = extractCarSkinsFromZipPaths(
      [
        'cars/bmw_m3/skins/05_white/preview.jpg',
        'cars/bmw_m3/skins/00_black/livery.dds',
        'cars/other/skins/x/a.png',
      ],
      'bmw_m3',
    );
    assert.deepEqual(skins, ['00_black', '05_white']);
  });

  it('extracts track layouts', () => {
    const configs = extractTrackConfigsFromZipPaths(
      [
        'tracks/akina/layout_down/surfaces.ini',
        'tracks/akina/ui/preview.png',
        'tracks/akina/layout_up/data.acd',
      ],
      'akina',
    );
    assert.deepEqual(configs, ['layout_down', 'layout_up']);
  });
});
