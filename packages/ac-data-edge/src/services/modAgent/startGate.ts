import fs from 'node:fs';
import path from 'node:path';
import { readServerInstanceConfig } from '../serverInstanceConfig.js';
import { contentPoolPath } from './materialize.js';
import { isModAgentEnabled, refreshServerModsOnHub } from './hubModClient.js';

export type ModStartGateResult =
  | { ok: true }
  | { ok: false; code: 'MODS_NOT_READY'; items: Array<{ acContentSlug: string; status: string }> };

function localContentExists(slug: string): boolean {
  const s = slug.trim();
  if (!s || s.includes('..') || s.includes('/') || s.includes('\\')) {
    return false;
  }
  const pool = contentPoolPath();
  return (
    fs.existsSync(path.join(pool, 'cars', s)) || fs.existsSync(path.join(pool, 'tracks', s))
  );
}

/**
 * Before AC start: prefer hub readiness, but never block when the slug is already
 * on this VPS CONTENT_PATH (inventory / catalog on disk). Remote hub may lag or
 * lack mod_packages rows for edge-only uploads.
 */
export async function assertModsReadyForServerStart(serverName: string): Promise<ModStartGateResult> {
  if (!isModAgentEnabled()) {
    return { ok: true };
  }
  const config = readServerInstanceConfig(serverName);

  let readiness: { ready: boolean; items: Array<{ acContentSlug: string; status: string }> };
  try {
    readiness = await refreshServerModsOnHub({
      serverName,
      track: config.track,
      cars: config.cars,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mod-start-gate] hub refresh failed (${message}); falling back to local CONTENT_PATH`);
    const slugs: string[] = [];
    if (config.track?.trim()) slugs.push(config.track.trim());
    if (config.cars) {
      for (const part of config.cars.split(/[;,]/)) {
        const t = part.trim();
        if (t) slugs.push(t);
      }
    }
    readiness = {
      ready: false,
      items: slugs.map((acContentSlug) => ({
        acContentSlug,
        status: localContentExists(acContentSlug) ? 'READY' : 'NOT_INSTALLED',
      })),
    };
    if (readiness.items.every((i) => i.status === 'READY')) {
      readiness.ready = true;
    }
  }

  if (readiness.ready) {
    return { ok: true };
  }

  const unresolved: Array<{ acContentSlug: string; status: string }> = [];
  for (const item of readiness.items) {
    if (item.status === 'READY') continue;
    if (localContentExists(item.acContentSlug)) {
      continue;
    }
    unresolved.push(item);
  }

  if (unresolved.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'MODS_NOT_READY',
    items: unresolved,
  };
}
