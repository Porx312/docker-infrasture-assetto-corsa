import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModPool, isModDbConfigured } from './db.js';

export async function runModMigrationsIfConfigured(): Promise<void> {
  if (!isModDbConfigured()) {
    console.log('[mod-db] DATABASE_URL not set — mod repository disabled');
    return;
  }
  const pool = getModPool();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(here, '..', '..', '..', 'migrations');
  const files = [
    '001_mod_repository.sql',
    '002_mod_car_track_split.sql',
    '003_server_slots.sql',
    '004_mod_package_preview.sql',
    '005_mod_package_category.sql',
    '006_fleet_edge_capacity.sql',
    '007_fleet_edge_processes.sql',
    '008_mod_artifact_edge_origin.sql',
    '009_drop_unused_mod_split.sql',
    '010_sync_jobs_one_active.sql',
    '011_mod_artifact_edge_folder.sql',
    '012_mod_artifact_s3_canonical.sql',
    '013_mod_steam_links.sql',
  ];
  for (const file of files) {
    const sqlPath = path.join(migrationsDir, file);
    if (!fs.existsSync(sqlPath)) {
      continue;
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');
    try {
      await pool.query(sql);
      console.log(`[mod-db] applied ${file}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Idempotent migrations may no-op; hard-fail only if later files cannot run.
      console.error(`[mod-db] applied ${file} FAILED: ${message}`);
      throw err;
    }
  }
}
