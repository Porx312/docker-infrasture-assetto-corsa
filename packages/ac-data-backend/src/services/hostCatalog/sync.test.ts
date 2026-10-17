import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildServerUpsertArgs,
  buildTrackUpsertArgs,
  extractCarSkinsFromZipPaths,
  extractTrackConfigsFromZipPaths,
  planServerPresenceSync,
  resolveHostCatalogRegion,
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

  it('extracts car skins from slim-relative entryPaths', () => {
    const skins = extractCarSkinsFromZipPaths(
      [
        'data.acd',
        'ui/ui_car.json',
        'skins/05_white/ui_skin.json',
        'skins/05_white/preview.jpg',
        'skins/00_black/ui_skin.json',
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

  it('extracts track layouts from slim-relative entryPaths', () => {
    const configs = extractTrackConfigsFromZipPaths(
      [
        'models.ini',
        'layout_down/data/surfaces.ini',
        'layout_up/data/surfaces.ini',
        'ui/layout_down/ui_track.json',
        'ui/ui_track.json',
        'data/surfaces.ini',
      ],
      'akina',
    );
    assert.deepEqual(configs, ['layout_down', 'layout_up']);
  });
});

describe('hostCatalog Convex payload builders', () => {
  it('buildTrackUpsertArgs defaults configTrack to ["default"] when empty', () => {
    const args = buildTrackUpsertArgs({
      track: 'monza',
      name: 'Monza',
      paths: ['models.ini', 'ui/ui_track.json'],
    });
    assert.deepEqual(args, {
      track: 'monza',
      name: 'Monza',
      configTrack: ['default'],
    });
  });

  it('buildTrackUpsertArgs keeps detected layouts', () => {
    const args = buildTrackUpsertArgs({
      track: 'akina',
      name: 'Akina',
      paths: ['layout_down/data/surfaces.ini'],
    });
    assert.deepEqual(args.configTrack, ['layout_down']);
  });

  it('buildServerUpsertArgs omits isActive and always sets region', () => {
    const prev = process.env.HOST_CATALOG_DEFAULT_REGION;
    delete process.env.HOST_CATALOG_DEFAULT_REGION;
    try {
      const args = buildServerUpsertArgs({
        instanceId: 'vps-eu-2',
        name: 'server-1',
      });
      assert.equal(args.instanceId, 'vps-eu-2');
      assert.equal(args.name, 'server-1');
      assert.equal(args.region, 'EU');
      assert.equal('isActive' in args, false);
      assert.equal('publicAccess' in args, false);
    } finally {
      if (prev !== undefined) process.env.HOST_CATALOG_DEFAULT_REGION = prev;
      else delete process.env.HOST_CATALOG_DEFAULT_REGION;
    }
  });

  it('buildServerUpsertArgs builds acstuff linkServers from joinIp + httpPort', () => {
    const args = buildServerUpsertArgs({
      instanceId: 'vps-eu-2',
      name: 'server-5',
      region: 'EU',
      vpsLabel: 'EU',
      joinIp: '13.140.160.131',
      httpPort: 8086,
    });
    assert.deepEqual(args, {
      instanceId: 'vps-eu-2',
      name: 'server-5',
      region: 'EU',
      vpsLabel: 'EU',
      linkServers:
        'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8086',
    });
  });

  it('buildServerUpsertArgs omits linkServers when httpPort missing', () => {
    const args = buildServerUpsertArgs({
      instanceId: 'vps-eu-2',
      name: 'server-1',
      joinIp: '13.140.160.131',
    });
    assert.equal('linkServers' in args, false);
  });

  it('buildServerUpsertArgs does not use bare https://ip as linkServers', () => {
    const args = buildServerUpsertArgs({
      instanceId: 'vps-eu-2',
      name: 'server-1',
      joinIp: '13.140.160.131',
      httpPort: 8081,
    });
    assert.equal(
      args.linkServers,
      'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8081',
    );
    assert.notEqual(args.linkServers, 'https://13.140.160.131');
  });

  it('resolveHostCatalogRegion maps labels and falls back to EU', () => {
    assert.equal(resolveHostCatalogRegion('na'), 'NA');
    assert.equal(resolveHostCatalogRegion('EU-West'), 'EU');
    assert.equal(resolveHostCatalogRegion(''), 'EU');
  });

  it('planServerPresenceSync without force only upserts added', () => {
    const previous = [{ name: 'server-1' }, { name: 'server-2' }];
    const current = [{ name: 'server-1' }, { name: 'server-2' }, { name: 'server-3' }];
    const plan = planServerPresenceSync({ previous, current });
    assert.deepEqual(plan.toUpsert, ['server-3']);
    assert.deepEqual(plan.toDelete, []);
  });

  it('planServerPresenceSync force upserts all current even if unchanged', () => {
    const slots = [{ name: 'server-1' }, { name: 'server-2' }];
    const plan = planServerPresenceSync({
      previous: slots,
      current: slots,
      force: true,
    });
    assert.deepEqual(plan.toUpsert, ['server-1', 'server-2']);
    assert.deepEqual(plan.toDelete, []);
  });

  it('planServerPresenceSync deletes removed unless force', () => {
    const plan = planServerPresenceSync({
      previous: [{ name: 'server-1' }, { name: 'old' }],
      current: [{ name: 'server-1' }],
    });
    assert.deepEqual(plan.toUpsert, []);
    assert.deepEqual(plan.toDelete, ['old']);
  });
});
