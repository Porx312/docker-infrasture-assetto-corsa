import '../../config/loadEnv.js';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isModDbConfigured(): boolean {
  return Boolean((process.env.DATABASE_URL || '').trim());
}

export function getModPool(): pg.Pool {
  if (!pool) {
    const connectionString = (process.env.DATABASE_URL || '').trim();
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }
    pool = new Pool({
      connectionString,
      max: Number(process.env.MOD_DB_POOL_SIZE || 10),
    });
  }
  return pool;
}

export async function closeModPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
