/**
 * Hub → Convex Host catalog (`battle_cars` / `battle_tracks` / `servers`).
 * See docs/HOST_CATALOG_SYNC.md. Failures are logged; they do not fail hub ops.
 */
import { ensureConvexClient } from '@projectd/ac-data-shared/services/convexClient.js';
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import type { AgentServerSlot } from '../controlApi/agentPresence.js';
import {
  HOST_CATALOG_MUTATIONS,
  isHostCatalogSyncEnabled,
  workerSecret,
} from './env.js';

export { isHostCatalogSyncEnabled } from './env.js';

/** Skins under cars/<slug>/skins/<skinId>/ or <slug>/skins/<skinId>/. */
export function extractCarSkinsFromZipPaths(paths: string[], carModel: string): string[] {
  const skins = new Set<string>();
  const re = new RegExp(`(?:^|/)${escapeRegExp(carModel)}/skins/([^/]+)/`, 'i');
  const reCars = new RegExp(`cars/${escapeRegExp(carModel)}/skins/([^/]+)/`, 'i');
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    const m = p.match(reCars) || p.match(re);
    const skin = m?.[1];
    if (skin && !skin.startsWith('.')) skins.add(skin);
  }
  return [...skins].sort();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Layout configs under tracks/<slug>/<layout>/ */
export function extractTrackConfigsFromZipPaths(paths: string[], track: string): string[] {
  const configs = new Set<string>();
  const re = new RegExp(`(?:^|/)tracks/${escapeRegExp(track)}/([^/]+)/`, 'i');
  const skip = new Set(['ui', 'data', 'skins', 'extension', 'models', 'texture', 'textures']);
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    const m = p.match(re);
    const layout = m?.[1];
    if (layout && !layout.startsWith('.') && !skip.has(layout.toLowerCase())) {
      configs.add(layout);
    }
  }
  return [...configs].sort();
}

export type HostCatalogUpsertInput = {
  kind: ModKind;
  displayName: string;
  acContentSlug: string;
  zipPaths?: string[];
  manifest?: ModManifest;
};

export type HostCatalogDeleteInput = {
  kind: ModKind;
  acContentSlug: string;
  displayName?: string;
};

async function runMutation(path: string, args: Record<string, unknown>): Promise<void> {
  const client = ensureConvexClient();
  await client.mutation(path, {
    ...args,
    workerSecret: workerSecret(),
  });
}

function folderName(slot: AgentServerSlot): string | null {
  const name = (slot.serverId || slot.name || '').trim();
  return name || null;
}

/**
 * Diff previous vs current agent servers[] and upsert/delete Convex `servers` rows.
 * Only mutates when the set of folder names changes (not every heartbeat).
 */
export async function syncHostCatalogServersFromPresence(input: {
  instanceId: string;
  previous: AgentServerSlot[];
  current: AgentServerSlot[];
}): Promise<void> {
  if (!isHostCatalogSyncEnabled()) {
    return;
  }
  const instanceId = input.instanceId.trim();
  if (!instanceId) {
    return;
  }

  const prevNames = new Set(
    input.previous.map(folderName).filter((n): n is string => Boolean(n)),
  );
  const currNames = new Set(
    input.current.map(folderName).filter((n): n is string => Boolean(n)),
  );

  const added = [...currNames].filter((n) => !prevNames.has(n));
  const removed = [...prevNames].filter((n) => !currNames.has(n));
  const toUpsert =
    prevNames.size === 0 && currNames.size > 0 ? [...currNames] : added;

  if (toUpsert.length === 0 && removed.length === 0) {
    return;
  }

  const upsertPath = HOST_CATALOG_MUTATIONS.upsertServer();
  const deletePath = HOST_CATALOG_MUTATIONS.deleteServer();

  for (const name of toUpsert) {
    try {
      await runMutation(upsertPath, {
        instanceId,
        name,
        isActive: true,
      });
      console.log(`[host-catalog] upsert server instanceId=${instanceId} name=${name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[host-catalog] upsert server failed (${name}): ${message}`);
    }
  }

  for (const name of removed) {
    try {
      await runMutation(deletePath, { instanceId, name });
      console.log(`[host-catalog] delete server instanceId=${instanceId} name=${name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[host-catalog] delete server failed (${name}): ${message}`);
    }
  }
}

export async function syncHostCatalogUpsert(input: HostCatalogUpsertInput): Promise<void> {
  if (!isHostCatalogSyncEnabled()) {
    return;
  }
  if (input.kind !== 'car' && input.kind !== 'track') {
    return;
  }
  const slug = input.acContentSlug.trim();
  if (!slug) {
    return;
  }
  const paths = input.zipPaths?.length ? input.zipPaths : (input.manifest?.rootPaths ?? []);

  try {
    if (input.kind === 'car') {
      const skins = extractCarSkinsFromZipPaths(paths, slug);
      await runMutation(HOST_CATALOG_MUTATIONS.upsertCar(), {
        carModel: slug,
        name: input.displayName,
        skins: skins.length ? skins : undefined,
      });
      console.log(`[host-catalog] upsert car carModel=${slug}`);
      return;
    }

    const configTrack = extractTrackConfigsFromZipPaths(paths, slug);
    await runMutation(HOST_CATALOG_MUTATIONS.upsertTrack(), {
      track: slug,
      name: input.displayName,
      configTrack: configTrack.length ? configTrack : undefined,
    });
    console.log(`[host-catalog] upsert track track=${slug}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[host-catalog] upsert failed (${input.kind}/${slug}): ${message}`);
  }
}

export async function syncHostCatalogDelete(input: HostCatalogDeleteInput): Promise<void> {
  if (!isHostCatalogSyncEnabled()) {
    return;
  }
  if (input.kind !== 'car' && input.kind !== 'track') {
    return;
  }
  const slug = input.acContentSlug.trim();
  if (!slug) {
    return;
  }
  try {
    if (input.kind === 'car') {
      await runMutation(HOST_CATALOG_MUTATIONS.deleteCar(), { carModel: slug });
      console.log(`[host-catalog] delete car carModel=${slug}`);
      return;
    }
    await runMutation(HOST_CATALOG_MUTATIONS.deleteTrack(), { track: slug });
    console.log(`[host-catalog] delete track track=${slug}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[host-catalog] delete failed (${input.kind}/${slug}): ${message}`);
  }
}
