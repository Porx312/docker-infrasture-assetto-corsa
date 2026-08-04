import fs from 'fs';
import path from 'path';
import { getContentPath } from './contentManager.js';
import { resolveContentDistribution, type SyncContentType } from './contentDistribution.js';
import { ensureContentZip, scheduleContentZipBuild } from './contentZipCache.js';
import { parseCarsField } from './launcherServerRegistry.js';
import { listServerInstanceNames } from './serverBranding.js';
import { readServerInstanceConfig } from './serverInstanceConfig.js';

export type WarmContentMod = {
  type: SyncContentType;
  name: string;
};

function parseWarmModToken(token: string): WarmContentMod | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const sep = trimmed.indexOf(':');
  if (sep <= 0) return null;

  const typeRaw = trimmed.slice(0, sep).trim();
  const name = trimmed.slice(sep + 1).trim();
  if (typeRaw !== 'cars' && typeRaw !== 'tracks') return null;
  if (!name) return null;

  return { type: typeRaw, name };
}

function parseWarmModsFromEnv(): WarmContentMod[] {
  const raw = process.env.CLIENT_SYNC_WARM_MODS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map(parseWarmModToken)
    .filter((entry): entry is WarmContentMod => entry !== null);
}

function collectModsFromServerConfigs(): WarmContentMod[] {
  const mods: WarmContentMod[] = [];

  for (const serverName of listServerInstanceNames()) {
    try {
      const config = readServerInstanceConfig(serverName);
      if (config.track.trim()) {
        mods.push({ type: 'tracks', name: config.track.trim() });
      }
      for (const car of parseCarsField(config.cars)) {
        mods.push({ type: 'cars', name: car });
      }
    } catch {
      /* skip unreadable server folder */
    }
  }

  return mods;
}

export function collectModsToWarm(extraMods: WarmContentMod[] = []): WarmContentMod[] {
  const seen = new Set<string>();
  const result: WarmContentMod[] = [];

  for (const mod of [...collectModsFromServerConfigs(), ...parseWarmModsFromEnv(), ...extraMods]) {
    const key = `${mod.type}:${mod.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mod);
  }

  return result;
}

function isWarmEnabled(): boolean {
  const raw = process.env.CLIENT_SYNC_ZIP_WARM?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function resolveWarmModPath(type: SyncContentType, name: string): string | null {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return null;
  }
  const base = getContentPath(type);
  const target = path.join(base, name);
  const resolved = path.resolve(target);
  const prefix = `${path.resolve(base)}${path.sep}`;
  if (resolved !== path.resolve(base) && !resolved.startsWith(prefix)) {
    return null;
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return resolved;
}

async function warmMod(mod: WarmContentMod, blocking: boolean): Promise<void> {
  const dist = resolveContentDistribution(mod.type, mod.name);
  if (!dist.downloadable) return;

  const modPath = resolveWarmModPath(mod.type, mod.name);
  if (!modPath) return;

  const stats = await fs.promises.stat(modPath);
  if (!stats.isDirectory()) return;

  if (blocking) {
    const cached = await ensureContentZip(mod.type, mod.name, modPath, stats.mtimeMs);
    console.log(
      `[content-zip-warmer] ready ${mod.type}/${mod.name} (${cached.sizeBytes} bytes)`,
    );
    return;
  }

  scheduleContentZipBuild(mod.type, mod.name, modPath, stats.mtimeMs);
}

/** CLI / deploy script — builds zip cache and waits for completion. */
export async function warmContentZipCacheNow(extraTokens: string[] = []): Promise<void> {
  const extraMods = extraTokens
    .map(parseWarmModToken)
    .filter((entry): entry is WarmContentMod => entry !== null);

  const mods = collectModsToWarm(extraMods);
  if (mods.length === 0) {
    console.log('[content-zip-warmer] no downloadable mods to warm');
    return;
  }

  console.log(`[content-zip-warmer] warming ${mods.length} mod(s)...`);
  for (const mod of mods) {
    try {
      await warmMod(mod, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[content-zip-warmer] failed ${mod.type}/${mod.name}: ${message}`);
    }
  }
}

/** Non-blocking startup prewarm for tracks/cars referenced by server configs. */
export function startContentZipCacheWarmer(): void {
  if (!isWarmEnabled()) {
    console.log('[content-zip-warmer] disabled (CLIENT_SYNC_ZIP_WARM=false)');
    return;
  }

  const mods = collectModsToWarm();
  if (mods.length === 0) {
    return;
  }

  console.log(`[content-zip-warmer] scheduling background warm for ${mods.length} mod(s)`);
  for (const mod of mods) {
    void warmMod(mod, false).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[content-zip-warmer] schedule failed ${mod.type}/${mod.name}: ${message}`);
    });
  }
}
