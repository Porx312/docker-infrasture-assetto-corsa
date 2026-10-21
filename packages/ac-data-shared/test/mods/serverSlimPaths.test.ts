import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterServerSlimRelPaths, isServerSlimRelativePath } from '../../src/mods/serverSlimPaths.js';

describe('serverSlimPaths', () => {
  it('allows car Pack files and rejects kn5/dds', () => {
    assert.equal(isServerSlimRelativePath('data.acd', 'car'), true);
    assert.equal(isServerSlimRelativePath('data/car.ini', 'car'), true);
    assert.equal(isServerSlimRelativePath('ui/ui_car.json', 'car'), true);
    assert.equal(isServerSlimRelativePath('skins/red/ui_skin.json', 'car'), true);
    assert.equal(isServerSlimRelativePath('skins/red/preview.jpg', 'car'), true);
    assert.equal(isServerSlimRelativePath('skins/red/body.kn5', 'car'), false);
    assert.equal(isServerSlimRelativePath('skins/red/livery.dds', 'car'), false);
    assert.equal(isServerSlimRelativePath('.acmod.json', 'car'), false);
  });

  it('allows track Pack files', () => {
    assert.equal(isServerSlimRelativePath('models.ini', 'track'), true);
    assert.equal(isServerSlimRelativePath('models_extended_circuit.ini', 'track'), true);
    assert.equal(isServerSlimRelativePath('extended_circuit/data/surfaces.ini', 'track'), true);
    assert.equal(isServerSlimRelativePath('extended_circuit/data/drs_zones.ini', 'track'), true);
    assert.equal(isServerSlimRelativePath('data/surfaces.ini', 'track'), true);
    assert.equal(isServerSlimRelativePath('ui/extended_circuit/ui_track.json', 'track'), true);
    assert.equal(isServerSlimRelativePath('ui/extended_circuit/preview.png', 'track'), true);
    assert.equal(isServerSlimRelativePath('extended_circuit/models.kn5', 'track'), false);
  });

  it('filterServerSlimRelPaths drops client assets', () => {
    const out = filterServerSlimRelPaths(
      ['data.acd', 'skins/a/body.kn5', 'skins/a/ui_skin.json', 'collider.kn5'],
      'car',
    );
    assert.deepEqual(out, ['data.acd', 'skins/a/ui_skin.json']);
  });
});
