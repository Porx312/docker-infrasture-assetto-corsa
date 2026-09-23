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
  const sqlPath = path.join(here, '..', '..', '..', 'migrations', '001_mod_repository.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('[mod-db] migrations applied');
}
