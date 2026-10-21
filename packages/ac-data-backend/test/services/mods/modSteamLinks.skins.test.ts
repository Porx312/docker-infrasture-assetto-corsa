import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { closeModPool, getModPool, isModDbConfigured } from '../../../src/services/mods/db.js';
import { runModMigrationsIfConfigured } from '../../../src/services/mods/migrate.js';
import {
  listModsForSteam,
  skinsFromManifest,
  upsertModSteamLink,
} from '../../../src/services/mods/modSteamLinks.js';

test('skinsFromManifest reads slim-relative skin folders', () => {
  const skins = skinsFromManifest('car', 'my_car', {
    entryPaths: [
      'data.acd',
      'ui/ui_car.json',
      'skins/05_white/ui_skin.json',
      'skins/05_white/preview.jpg',
      'skins/00_black/ui_skin.json',
    ],
  });
  assert.deepEqual(skins, ['00_black', '05_white']);
});

test('skinsFromManifest empty for tracks', () => {
  assert.deepEqual(
    skinsFromManifest('track', 'otarumi', {
      entryPaths: ['skins/nope/ui_skin.json'],
    }),
    [],
  );
});

test('listModsForSteam includes skins from artifact manifest', async (t) => {
  if (!isModDbConfigured()) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const packageId = randomUUID();
  const artifactId = randomUUID();
  const steamId = '76561199000000999';
  const slug = `car_skin_${packageId.slice(0, 8)}`;
  const sha = randomUUID().replace(/-/g, '');
  const pool = getModPool();
  try {
    await pool.query(
      `INSERT INTO mod_packages (id, slug, display_name, kind, ac_content_slug)
       VALUES ($1, $2, $3, 'car', $4)`,
      [packageId, `pkg-${packageId.slice(0, 8)}`, 'Skin Test', slug],
    );
    await pool.query(
      `INSERT INTO mod_artifacts (id, package_id, version_label, size_bytes, sha256, storage_key, manifest_json)
       VALUES ($1, $2, '1.0', 100, $3, $4, $5::jsonb)`,
      [
        artifactId,
        packageId,
        sha,
        `library/${sha}.tar.gz`,
        JSON.stringify({
          entryPaths: [
            'data.acd',
            'skins/red/ui_skin.json',
            'skins/blue/preview.png',
          ],
          s3Key: `library/${sha}.tar.gz`,
          s3Sha256: sha,
          s3SizeBytes: 100,
          s3Format: 'server-slim-tar-gz',
        }),
      ],
    );
    await upsertModSteamLink(steamId, packageId);
    const items = await listModsForSteam(steamId);
    const hit = items.find((i) => i.packageId === packageId);
    assert.ok(hit);
    assert.deepEqual(hit!.skins, ['blue', 'red']);
  } finally {
    await pool.query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]);
    await closeModPool();
  }
});
