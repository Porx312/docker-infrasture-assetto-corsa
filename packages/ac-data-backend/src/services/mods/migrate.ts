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
  ];
  for (const file of files) {
    const sqlPath = path.join(migrationsDir, file);
    if (!fs.existsSync(sqlPath)) {
      continue;
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log(`[mod-db] applied ${file}`);
  }
}
