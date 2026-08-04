#!/usr/bin/env node
/**
 * Warm launcher content ZIP cache (blocking). Use after deploy or before first player download.
 *
 * Usage:
 *   cd ac-data && npx tsx scripts/warm-content-zip-cache.mjs
 *   cd ac-data && npx tsx scripts/warm-content-zip-cache.mjs tracks:pk_akina cars:my_mod
 *
 * Reads ASSETTO_ENV_FILE / .env.local via loadEnv. Also honors CLIENT_SYNC_WARM_MODS and
 * TRACK/CARS from all server_cfg.ini under SERVERS_PATH.
 */
import '../src/config/loadEnv.js';
import { warmContentZipCacheNow } from '../src/services/contentZipWarmer.js';

const extra = process.argv.slice(2);
await warmContentZipCacheNow(extra);
