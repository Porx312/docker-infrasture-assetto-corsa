import fs from 'node:fs';
import path from 'node:path';
import { readServerInstanceConfig } from '@projectd/ac-data-shared/services/serverInstanceConfig.js';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unresolvedItems(
  items: Array<{ acContentSlug: string; status: string }>,
): Array<{ acContentSlug: string; status: string }> {
  const unresolved: Array<{ acContentSlug: string; status: string }> = [];
  for (const item of items) {
    if (item.status === 'READY') continue;
    if (localContentExists(item.acContentSlug)) continue;
    unresolved.push(item);
  }
  return unresolved;
}

/**
 * Before AC start: refresh hub requirements, enqueue missing installs from S3,
 * then wait (poll) until CONTENT_PATH has what we need or timeout.
 */
export async function assertModsReadyForServerStart(serverName: string): Promise<ModStartGateResult> {
  if (!isModAgentEnabled()) {
    return { ok: true };
  }
  const config = readServerInstanceConfig(serverName);
  const timeoutMs = Number(process.env.MOD_START_INSTALL_TIMEOUT_MS || 300_000);
  const pollMs = Number(process.env.MOD_START_INSTALL_POLL_MS || 2500);

  let readiness: { ready: boolean; items: Array<{ acContentSlug: string; status: string }> };
  try {
    readiness = await refreshServerModsOnHub({
      serverName,
      track: config.track,
      cars: config.cars,
      installMissing: true,
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

  const deadline = Date.now() + Math.max(0, timeoutMs);
  let unresolved = unresolvedItems(readiness.items);
  if (unresolved.length === 0) {
    return { ok: true };
  }

  console.log(
    `[mod-start-gate] waiting for ${unresolved.length} mod(s) (timeout=${timeoutMs}ms): ${unresolved
      .map((i) => i.acContentSlug)
      .join(', ')}`,
  );

  while (Date.now() < deadline) {
    await sleep(pollMs);
    try {
      readiness = await refreshServerModsOnHub({
        serverName,
        track: config.track,
        cars: config.cars,
        installMissing: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mod-start-gate] poll failed: ${message}`);
    }
    unresolved = unresolvedItems(readiness.items);
    if (unresolved.length === 0) {
      console.log(`[mod-start-gate] mods ready for ${serverName}`);
      return { ok: true };
    }
  }

  return {
    ok: false,
    code: 'MODS_NOT_READY',
    items: unresolved,
  };
}
