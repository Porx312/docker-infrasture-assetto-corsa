/**
 * Concurrent enqueue against real Postgres (AUD2-07).
 * Skips when DATABASE_URL is unset.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { closeModPool, getModPool, isModDbConfigured } from './db.js';
import { runModMigrationsIfConfigured } from './migrate.js';
import { acquireJobForEdge, enqueueJob } from './orchestrator.js';

const hasDb = isModDbConfigured();

async function seedEdgeAndArtifacts(
  edgeId: string,
  count: number,
): Promise<string[]> {
  const pool = getModPool();
  await pool.query(
    `INSERT INTO fleet_edges (id, label, base_url) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [edgeId, edgeId, 'http://127.0.0.1:3999'],
  );
  const artifactIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const packageId = randomUUID();
    const artifactId = randomUUID();
    const sha = randomUUID().replace(/-/g, '');
    artifactIds.push(artifactId);
    await pool.query(
      `INSERT INTO mod_packages (id, slug, display_name, kind, ac_content_slug)
       VALUES ($1, $2, $3, 'car', $4)`,
      [packageId, `pkg-${packageId.slice(0, 8)}`, `Car ${i}`, `car_${packageId.slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO mod_artifacts (id, package_id, version_label, size_bytes, sha256, storage_key, manifest_json)
       VALUES ($1, $2, '1.0', 100, $3, $4, '{}'::jsonb)`,
      [artifactId, packageId, sha, `master/${sha}.zip`],
    );
    await pool.query(
      `INSERT INTO edge_artifact_inventory (edge_id, artifact_id, package_id, status)
       VALUES ($1, $2, $3, 'NOT_INSTALLED')
       ON CONFLICT (edge_id, artifact_id) DO NOTHING`,
      [edgeId, artifactId, packageId],
    );
  }
  return artifactIds;
}

test('concurrent enqueueJob yields one active job (AUD2-07)', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const edgeId = `edge-c-${randomUUID().slice(0, 8)}`;
  const [artifactId] = await seedEdgeAndArtifacts(edgeId, 1);
  assert.ok(artifactId);
  try {
    const ids = await Promise.all(
      Array.from({ length: 12 }, () => enqueueJob(edgeId, artifactId, 'install')),
    );
    assert.equal(new Set(ids).size, 1);
    const r = await getModPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync_jobs
       WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running')`,
      [edgeId, artifactId],
    );
    assert.equal(Number(r.rows[0]?.count || 0), 1);
  } finally {
    await getModPool().query(`DELETE FROM fleet_edges WHERE id = $1`, [edgeId]);
    await closeModPool();
  }
});

test('concurrent acquireJobForEdge respects peer-pull cap (AUD2-07)', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set');
    return;
  }
  await runModMigrationsIfConfigured();
  const prev = process.env.MOD_PEER_PULL_MAX_CONCURRENT;
  process.env.MOD_PEER_PULL_MAX_CONCURRENT = '2';
  const edgeId = `edge-cap-${randomUUID().slice(0, 8)}`;
  const artifactIds = await seedEdgeAndArtifacts(edgeId, 5);

  try {
    for (const artifactId of artifactIds) {
      await enqueueJob(edgeId, artifactId, 'install');
    }

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => acquireJobForEdge(edgeId, `agent-${i}`)),
    );
    const acquired = results.filter((r) => r !== null);
    const running = await getModPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync_jobs
       WHERE edge_id = $1 AND state = 'running' AND operation IN ('install', 'upgrade')`,
      [edgeId],
    );
    const n = Number(running.rows[0]?.count || 0);
    assert.ok(n <= 2, `running=${n} exceeds cap=2`);
    assert.ok(acquired.length <= 2);

    // At cap, further acquire returns null.
    const blocked = await acquireJobForEdge(edgeId, 'agent-blocked');
    assert.equal(blocked, null);
  } finally {
    if (prev === undefined) delete process.env.MOD_PEER_PULL_MAX_CONCURRENT;
    else process.env.MOD_PEER_PULL_MAX_CONCURRENT = prev;
    await getModPool().query(`DELETE FROM fleet_edges WHERE id = $1`, [edgeId]);
    await closeModPool();
  }
});
