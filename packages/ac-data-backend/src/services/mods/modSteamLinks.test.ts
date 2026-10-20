import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { closeModPool, getModPool, isModDbConfigured } from './db.js';
import { runModMigrationsIfConfigured } from './migrate.js';
import {
  countPackageSteamLinks,
  isValidSteam64,
  listModsForSteam,
  upsertModSteamLink,
} from './modSteamLinks.js';
import { unlinkSteamMod } from './unlinkSteamMod.js';

const hasDb = isModDbConfigured();

test('isValidSteam64 accepts Steam64 only', () => {
  assert.equal(isValidSteam64('76561199000000001'), true);
  assert.equal(isValidSteam64('76561198000000000'), true);
  assert.equal(isValidSteam64('123'), false);
  assert.equal(isValidSteam64('unknown_player'), false);
  assert.equal(isValidSteam64(''), false);
});

async function seedPackageWithArtifact(): Promise<{
  packageId: string;
  artifactId: string;
  slug: string;
}> {
  const pool = getModPool();
  const packageId = randomUUID();
  const artifactId = randomUUID();
  const slug = `car_steam_${packageId.slice(0, 8)}`;
  const sha = randomUUID().replace(/-/g, '');
  await pool.query(
    `INSERT INTO mod_packages (id, slug, display_name, kind, ac_content_slug)
     VALUES ($1, $2, $3, 'car', $4)`,
    [packageId, `pkg-${packageId.slice(0, 8)}`, `Steam ${slug}`, slug],
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
        s3Key: `library/${sha}.tar.gz`,
        s3Sha256: sha,
        s3SizeBytes: 100,
        s3Format: 'server-slim-tar-gz',
      }),
    ],
  );
  return { packageId, artifactId, slug };
}

test('upsert + list + second steam shares one package', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const { packageId } = await seedPackageWithArtifact();
  const steamA = '76561199000000001';
  const steamB = '76561199000000002';
  try {
    await upsertModSteamLink(steamA, packageId);
    await upsertModSteamLink(steamB, packageId);
    assert.equal(await countPackageSteamLinks(packageId), 2);
    const listA = await listModsForSteam(steamA);
    assert.equal(listA.length, 1);
    assert.equal(listA[0]?.packageId, packageId);
    const listB = await listModsForSteam(steamB);
    assert.equal(listB.length, 1);
  } finally {
    await getModPool().query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]);
    await closeModPool();
  }
});

test('unlinkSteamMod first user keeps package; last user purges', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const { packageId } = await seedPackageWithArtifact();
  const steamA = '76561199000000011';
  const steamB = '76561199000000012';
  await upsertModSteamLink(steamA, packageId);
  await upsertModSteamLink(steamB, packageId);

  const prevRegistry = process.env.FLEET_EDGE_REGISTRY;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({});
  process.env.FLEET_EDGE_SECRET = 'test-secret';
  resetFleetRegistryForTests();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

  try {
    const first = await unlinkSteamMod(steamA, packageId);
    assert.equal(first.status, 'unlinked');
    if (first.status === 'unlinked') {
      assert.equal(first.remainingLinks, 1);
    }
    const still = await getModPool().query(`SELECT id FROM mod_packages WHERE id = $1`, [
      packageId,
    ]);
    assert.equal(still.rows.length, 1);

    const last = await unlinkSteamMod(steamB, packageId);
    assert.equal(last.status, 'purged');
    const gone = await getModPool().query(`SELECT id FROM mod_packages WHERE id = $1`, [
      packageId,
    ]);
    assert.equal(gone.rows.length, 0);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevRegistry === undefined) delete process.env.FLEET_EDGE_REGISTRY;
    else process.env.FLEET_EDGE_REGISTRY = prevRegistry;
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
    resetFleetRegistryForTests();
    await getModPool().query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]).catch(() => undefined);
    await closeModPool();
  }
});

test('unlinkSteamMod last link unlinks but keeps package when server_mod_requirements', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const { packageId, artifactId, slug } = await seedPackageWithArtifact();
  const steamA = '76561199000000021';
  const edgeId = `edge-steam-${randomUUID().slice(0, 8)}`;
  await upsertModSteamLink(steamA, packageId);
  await getModPool().query(
    `INSERT INTO fleet_edges (id, label, base_url) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [edgeId, edgeId, 'http://127.0.0.1:3999'],
  );
  await getModPool().query(
    `INSERT INTO server_mod_requirements
       (server_name, edge_id, package_id, artifact_id, ac_content_slug, kind, updated_at)
     VALUES ('server-1', $1, $2, $3, $4, 'car', NOW())`,
    [edgeId, packageId, artifactId, slug],
  );

  try {
    const result = await unlinkSteamMod(steamA, packageId);
    assert.equal(result.status, 'unlinked');
    if (result.status === 'unlinked') {
      assert.equal(result.remainingLinks, 0);
      assert.equal(result.purgeSkipped, 'mod_in_use');
      assert.ok(result.usage && result.usage.length >= 1);
    }
    const still = await getModPool().query(`SELECT id FROM mod_packages WHERE id = $1`, [
      packageId,
    ]);
    assert.equal(still.rows.length, 1);
    assert.equal(await countPackageSteamLinks(packageId), 0);
  } finally {
    await getModPool().query(`DELETE FROM fleet_edges WHERE id = $1`, [edgeId]);
    await getModPool().query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]);
    await closeModPool();
  }
});

test('unlinkSteamMod without link throws link_not_found', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const { packageId } = await seedPackageWithArtifact();
  try {
    await assert.rejects(
      () => unlinkSteamMod('76561199000000099', packageId),
      (err: unknown) => err instanceof Error && err.message === 'link_not_found',
    );
  } finally {
    await getModPool().query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]);
    await closeModPool();
  }
});
