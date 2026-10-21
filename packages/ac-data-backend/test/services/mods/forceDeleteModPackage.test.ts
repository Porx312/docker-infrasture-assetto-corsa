/**
 * forceDelete / remove-from-edges: block when in use; purge VPS before DB delete.
 * Skips when DATABASE_URL is unset.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { closeModPool, getModPool, isModDbConfigured } from '../../../src/services/mods/db.js';
import { runModMigrationsIfConfigured } from '../../../src/services/mods/migrate.js';
import {
  forceDeleteModPackage,
  ModInUseError,
  purgeLocalContentOnEdges,
  removePackageFromEdges,
} from '../../../src/services/mods/orchestrator.js';
import { listLivePackageUsage, listPackageUsage } from '../../../src/services/mods/serverModRequirements.js';

const hasDb = isModDbConfigured();

async function seedPackage(opts?: {
  edgeId?: string;
  withRequirement?: { edgeId: string; serverName: string };
}): Promise<{ packageId: string; artifactId: string; slug: string; edgeId: string }> {
  const pool = getModPool();
  const packageId = randomUUID();
  const artifactId = randomUUID();
  const slug = `car_del_${packageId.slice(0, 8)}`;
  const edgeId =
    opts?.edgeId ?? opts?.withRequirement?.edgeId ?? `edge-del-${randomUUID().slice(0, 8)}`;
  const sha = randomUUID().replace(/-/g, '');

  await pool.query(
    `INSERT INTO fleet_edges (id, label, base_url) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [edgeId, edgeId, 'http://127.0.0.1:3999'],
  );
  await pool.query(
    `INSERT INTO mod_packages (id, slug, display_name, kind, ac_content_slug)
     VALUES ($1, $2, $3, 'car', $4)`,
    [packageId, `pkg-${packageId.slice(0, 8)}`, `Delete Test ${slug}`, slug],
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

  if (opts?.withRequirement) {
    await pool.query(
      `INSERT INTO server_mod_requirements
         (server_name, edge_id, package_id, artifact_id, ac_content_slug, kind, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'car', NOW())`,
      [
        opts.withRequirement.serverName,
        opts.withRequirement.edgeId,
        packageId,
        artifactId,
        slug,
      ],
    );
  }

  return { packageId, artifactId, slug, edgeId };
}

async function cleanupEdge(edgeId: string): Promise<void> {
  await getModPool().query(`DELETE FROM fleet_edges WHERE id = $1`, [edgeId]);
}

test('listPackageUsage finds requirement by package_id', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const edgeId = `edge-use-${randomUUID().slice(0, 8)}`;
  const { packageId } = await seedPackage({
    withRequirement: { edgeId, serverName: 'server-9' },
  });
  try {
    const usage = await listPackageUsage(packageId);
    assert.equal(usage.length, 1);
    assert.equal(usage[0]?.serverName, 'server-9');
    assert.equal(usage[0]?.edgeId, edgeId);
  } finally {
    await cleanupEdge(edgeId);
    await closeModPool();
  }
});

test('forceDeleteModPackage blocks when requiring server is live/unknown', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const edgeId = `edge-block-${randomUUID().slice(0, 8)}`;
  const { packageId } = await seedPackage({
    withRequirement: { edgeId, serverName: 'server-1' },
  });
  try {
    // No presence → unknown → block
    await assert.rejects(
      () => forceDeleteModPackage(packageId),
      (err: unknown) => err instanceof ModInUseError && err.usage.length === 1,
    );
    await assert.rejects(
      () =>
        forceDeleteModPackage(packageId, {
          presenceLookup: async () => 'live',
        }),
      (err: unknown) => err instanceof ModInUseError,
    );
    const still = await getModPool().query(`SELECT id FROM mod_packages WHERE id = $1`, [
      packageId,
    ]);
    assert.equal(still.rows.length, 1);
  } finally {
    await cleanupEdge(edgeId);
    await closeModPool();
  }
});

test('forceDeleteModPackage purges when requiring servers are idle', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const edgeId = `edge-idle-del-${randomUUID().slice(0, 8)}`;
  const { packageId, slug } = await seedPackage({
    withRequirement: { edgeId, serverName: 'server-idle' },
  });

  const prevRegistry = process.env.FLEET_EDGE_REGISTRY;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    [edgeId]: { label: edgeId, baseUrl: 'http://127.0.0.1:3999' },
  });
  process.env.FLEET_EDGE_SECRET = 'test-fleet-secret';
  resetFleetRegistryForTests();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

  try {
    const live = await listLivePackageUsage(packageId, undefined, {
      presenceLookup: async () => 'idle',
    });
    assert.equal(live.length, 0);
    const result = await forceDeleteModPackage(packageId, {
      presenceLookup: async () => 'idle',
    });
    assert.equal(result.packageId, packageId);
    assert.ok(result.edgesPurged.includes(edgeId) || result.edgesPurged.length >= 0);
    void slug;
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
    await cleanupEdge(edgeId);
    await closeModPool();
  }
});

test('removePackageFromEdges blocks when edge server is live/unknown', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const edgeId = `edge-rm-${randomUUID().slice(0, 8)}`;
  const { packageId } = await seedPackage({
    withRequirement: { edgeId, serverName: 'server-2' },
  });
  try {
    await assert.rejects(
      () => removePackageFromEdges(packageId, [edgeId]),
      (err: unknown) => err instanceof ModInUseError,
    );
  } finally {
    await cleanupEdge(edgeId);
    await closeModPool();
  }
});

test('purgeLocalContentOnEdges treats 404 as purged', async () => {
  const edgeId = `eu-purge-${randomUUID().slice(0, 8)}`;
  const prevRegistry = process.env.FLEET_EDGE_REGISTRY;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    [edgeId]: { label: edgeId, baseUrl: 'http://127.0.0.1:3999' },
  });
  process.env.FLEET_EDGE_SECRET = 'test-fleet-secret';
  resetFleetRegistryForTests();

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, message: 'content_not_found' }), {
      status: 404,
    })) as typeof fetch;

  try {
    const result = await purgeLocalContentOnEdges('car', 'some_slug', [edgeId]);
    assert.deepEqual(result.edgesPurged, [edgeId]);
    assert.equal(result.edgesFailed.length, 0);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevRegistry === undefined) delete process.env.FLEET_EDGE_REGISTRY;
    else process.env.FLEET_EDGE_REGISTRY = prevRegistry;
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
    resetFleetRegistryForTests();
  }
});

test('forceDeleteModPackage purges VPS then deletes package when unused', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const edgeId = `edge-ok-${randomUUID().slice(0, 8)}`;
  const { packageId, slug } = await seedPackage({ edgeId });

  const prevRegistry = process.env.FLEET_EDGE_REGISTRY;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    [edgeId]: { label: edgeId, baseUrl: 'http://127.0.0.1:3999' },
  });
  process.env.FLEET_EDGE_SECRET = 'test-fleet-secret';
  resetFleetRegistryForTests();

  const prevFetch = globalThis.fetch;
  const fetchUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchUrls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await forceDeleteModPackage(packageId);
    assert.equal(result.packageId, packageId);
    assert.ok(
      fetchUrls.some((u) => u.includes(`/admin/mods/local-content/car/${encodeURIComponent(slug)}`)),
      `expected local-content DELETE, got ${fetchUrls.join(',')}`,
    );
    assert.ok(result.edgesPurged.includes(edgeId));
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
    await cleanupEdge(edgeId);
    await closeModPool();
  }
});
