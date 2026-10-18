import fs from 'node:fs';
import path from 'node:path';
import { readServerInstanceConfig } from '@projectd/ac-data-shared/services/serverInstanceConfig.js';
import { contentPoolPath } from './materialize.js';
import { isModAgentEnabled, refreshServerModsOnHub } from './hubModClient.js';
import { restartServerCore, startServerCore } from '../../controller/controller.js';

export type ModStartGateItem = {
  acContentSlug: string;
  status: string;
};

export type ModInstallError = {
  acContentSlug: string;
  artifactId: string | null;
  message: string;
};

export type ModContentOverrides = {
  track?: string;
  cars?: string;
};

export type ModStartGateResult =
  | { ok: true }
  | {
      ok: false;
      code: 'MODS_NOT_READY';
      items: ModStartGateItem[];
      reason?: string;
      installErrors?: ModInstallError[];
    };

export type StartWithModsResult =
  | { ok: true; message: string }
  | {
      ok: false;
      code?: 'MODS_NOT_READY';
      message: string;
      missing?: ModStartGateItem[];
      installErrors?: ModInstallError[];
    };

/** In-flight ensure promises — concurrent starts for the same server share one wait. */
const ensureInFlight = new Map<string, Promise<ModStartGateResult>>();

export function localContentExists(slug: string): boolean {
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

export function requiredSlugsFromConfig(config: {
  track?: string;
  cars?: string;
}): string[] {
  const slugs: string[] = [];
  if (config.track?.trim()) slugs.push(config.track.trim());
  if (config.cars) {
    for (const part of config.cars.split(/[;,]/)) {
      const t = part.trim();
      if (t) slugs.push(t);
    }
  }
  return slugs;
}

/**
 * Hub READY (post-verify inventory) or folder already on CONTENT_PATH.
 * queued / running / SYNCING / NOT_INSTALLED never count as ready without local disk.
 */
export function unresolvedModItems(
  items: ModStartGateItem[],
): ModStartGateItem[] {
  const unresolved: ModStartGateItem[] = [];
  for (const item of items) {
    if (item.status === 'READY' && localContentExists(item.acContentSlug)) {
      continue;
    }
    if (item.status === 'READY') {
      // Hub says READY but folder missing — treat as not ready (stale inventory).
      unresolved.push({ ...item, status: item.status || 'NOT_INSTALLED' });
      continue;
    }
    if (localContentExists(item.acContentSlug)) {
      continue;
    }
    unresolved.push(item);
  }
  return unresolved;
}

/** Catalog miss / no artifact — waiting will never help. */
export function isUnrecoverableModBlocker(
  items: ModStartGateItem[],
  installErrors: ModInstallError[] = [],
): ModStartGateItem[] {
  const fromStatus = items.filter(
    (i) =>
      i.status === 'UNKNOWN_PACKAGE' ||
      i.status === 'NO_ARTIFACT' ||
      i.status === 'MISSING_S3',
  );
  const errSlugs = new Set(
    installErrors
      .filter(
        (e) =>
          /no_catalog_artifact|UNKNOWN_PACKAGE|MOD_S3_PULL_ENABLED is not 1|no validated s3Key|peer_pull_disabled/i.test(
            e.message,
          ),
      )
      .map((e) => e.acContentSlug),
  );
  const fromErrors = items.filter((i) => errSlugs.has(i.acContentSlug));
  const seen = new Set<string>();
  const out: ModStartGateItem[] = [];
  for (const item of [...fromStatus, ...fromErrors]) {
    if (seen.has(item.acContentSlug)) continue;
    seen.add(item.acContentSlug);
    out.push(item);
  }
  return out;
}

function localOnlyReadiness(slugs: string[]): {
  ready: boolean;
  items: ModStartGateItem[];
} {
  const items = slugs.map((acContentSlug) => ({
    acContentSlug,
    status: localContentExists(acContentSlug) ? 'READY' : 'NOT_INSTALLED',
  }));
  return {
    ready: items.every((i) => i.status === 'READY'),
    items,
  };
}

function mergeConfigWithOverrides(
  serverName: string,
  overrides?: ModContentOverrides,
): { track?: string; cars?: string } {
  let fileTrack: string | undefined;
  let fileCars: string | undefined;
  try {
    const fileCfg = readServerInstanceConfig(serverName);
    fileTrack = fileCfg.track;
    fileCars = fileCfg.cars;
  } catch {
    // Redis preflight may run before the instance folder exists / valid name check.
  }
  return {
    track: overrides?.track?.trim() || fileTrack,
    cars: overrides?.cars?.trim() || fileCars,
  };
}

function failUnrecoverable(
  blockers: ModStartGateItem[],
  installErrors: ModInstallError[],
): ModStartGateResult {
  console.warn(
    `[mod-start-gate] unrecoverable (upload to library / fix S3): ${blockers
      .map((i) => `${i.acContentSlug}(${i.status})`)
      .join(', ')}`,
  );
  return {
    ok: false,
    code: 'MODS_NOT_READY',
    items: blockers,
    reason: 'unknown_package',
    installErrors,
  };
}

async function ensureModsReadyForServerStartInner(
  serverName: string,
  overrides?: ModContentOverrides,
): Promise<ModStartGateResult> {
  const config = mergeConfigWithOverrides(serverName, overrides);
  const required = requiredSlugsFromConfig(config);
  const timeoutMs = Number(process.env.MOD_START_INSTALL_TIMEOUT_MS || 300_000);
  const pollMs = Number(process.env.MOD_START_INSTALL_POLL_MS || 2500);
  const resyncEveryMs = Number(process.env.MOD_START_RESYNC_EVERY_MS || 15_000);

  if (!isModAgentEnabled()) {
    const local = localOnlyReadiness(required);
    if (local.ready) {
      return { ok: true };
    }
    console.warn(
      `[mod-start-gate] MOD_AGENT_ENABLED!=true and missing local mods for ${serverName}: ${local.items
        .filter((i) => i.status !== 'READY')
        .map((i) => i.acContentSlug)
        .join(', ')}`,
    );
    return {
      ok: false,
      code: 'MODS_NOT_READY',
      items: local.items.filter((i) => i.status !== 'READY'),
      reason: 'mod_agent_disabled_and_content_missing',
    };
  }

  if (required.length === 0) {
    return { ok: true };
  }

  let lastInstallErrors: ModInstallError[] = [];
  let readiness: {
    ready: boolean;
    items: ModStartGateItem[];
    installErrors?: ModInstallError[];
  };

  try {
    const hub = await refreshServerModsOnHub({
      serverName,
      track: config.track,
      cars: config.cars,
      installMissing: true,
    });
    readiness = hub;
    lastInstallErrors = hub.installErrors || [];
    if (lastInstallErrors.length) {
      console.warn(
        `[mod-start-gate] installErrors: ${lastInstallErrors
          .map((e) => `${e.acContentSlug}: ${e.message}`)
          .join(' | ')}`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mod-start-gate] hub refresh failed (${message}); falling back to local CONTENT_PATH`);
    readiness = localOnlyReadiness(required);
  }

  let unresolved = unresolvedModItems(readiness.items);
  if (unresolved.length === 0) {
    return { ok: true };
  }

  const blockers = isUnrecoverableModBlocker(unresolved, lastInstallErrors);
  if (blockers.length > 0) {
    return failUnrecoverable(blockers, lastInstallErrors);
  }

  console.log(
    `[mod-start-gate] waiting for ${unresolved.length} mod(s) (timeout=${timeoutMs}ms): ${unresolved
      .map((i) => `${i.acContentSlug}(${i.status})`)
      .join(', ')}`,
  );

  const deadline = Date.now() + Math.max(0, timeoutMs);
  let lastResyncAt = Date.now();

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const now = Date.now();
    const shouldResync = now - lastResyncAt >= resyncEveryMs;
    try {
      const hub = await refreshServerModsOnHub({
        serverName,
        track: config.track,
        cars: config.cars,
        installMissing: shouldResync,
      });
      if (shouldResync) lastResyncAt = now;
      readiness = hub;
      if (hub.installErrors?.length) {
        lastInstallErrors = hub.installErrors;
        console.warn(
          `[mod-start-gate] installErrors: ${hub.installErrors
            .map((e) => `${e.acContentSlug}: ${e.message}`)
            .join(' | ')}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mod-start-gate] poll failed: ${message}`);
    }
    unresolved = unresolvedModItems(readiness.items);
    if (unresolved.length === 0) {
      console.log(`[mod-start-gate] mods ready for ${serverName}`);
      return { ok: true };
    }
    const midBlockers = isUnrecoverableModBlocker(unresolved, lastInstallErrors);
    if (midBlockers.length > 0) {
      return failUnrecoverable(midBlockers, lastInstallErrors);
    }
  }

  console.warn(
    `[mod-start-gate] timeout for ${serverName}: still missing ${unresolved
      .map((i) => `${i.acContentSlug}(${i.status})`)
      .join(', ')}`,
  );
  return {
    ok: false,
    code: 'MODS_NOT_READY',
    items: unresolved,
    reason: 'install_timeout',
    installErrors: lastInstallErrors,
  };
}

/**
 * Ensure required mods are on CONTENT_PATH (install from S3 via hub when agent enabled).
 * `overrides` lets Redis applier pass track/cars before server_cfg.ini is rewritten.
 * Concurrent callers for the same serverName+overrides share one in-flight promise.
 */
export async function ensureModsReadyForServerStart(
  serverName: string,
  overrides?: ModContentOverrides,
): Promise<ModStartGateResult> {
  const key = [
    serverName.trim().toLowerCase(),
    overrides?.track?.trim() || '',
    overrides?.cars?.trim() || '',
  ].join('\0');
  const existing = ensureInFlight.get(key);
  if (existing) {
    return existing;
  }
  const promise = ensureModsReadyForServerStartInner(serverName, overrides).finally(() => {
    ensureInFlight.delete(key);
  });
  ensureInFlight.set(key, promise);
  return promise;
}

/** @deprecated Prefer ensureModsReadyForServerStart */
export async function assertModsReadyForServerStart(
  serverName: string,
): Promise<ModStartGateResult> {
  return ensureModsReadyForServerStart(serverName);
}

export async function startServerWithMods(
  serverName: string,
  overrides?: ModContentOverrides,
): Promise<StartWithModsResult> {
  const gate = await ensureModsReadyForServerStart(serverName, overrides);
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code,
      message:
        gate.reason === 'unknown_package'
          ? 'Required mods missing from library (upload to S3 catalog first)'
          : 'Required mods are not READY on this VPS',
      missing: gate.items,
      installErrors: gate.installErrors,
    };
  }
  const result = startServerCore(serverName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, message: result.message };
}

/**
 * Ensure mods, then stop+start (same order as restartServerCore).
 */
export async function restartServerWithMods(
  serverName: string,
  overrides?: ModContentOverrides,
): Promise<StartWithModsResult> {
  const gate = await ensureModsReadyForServerStart(serverName, overrides);
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code,
      message:
        gate.reason === 'unknown_package'
          ? 'Required mods missing from library (upload to S3 catalog first)'
          : 'Required mods are not READY on this VPS',
      missing: gate.items,
      installErrors: gate.installErrors,
    };
  }
  const result = await restartServerCore(serverName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, message: result.message };
}

/** Test helper — clear concurrent-start map. */
export function _resetEnsureInFlightForTests(): void {
  ensureInFlight.clear();
}
