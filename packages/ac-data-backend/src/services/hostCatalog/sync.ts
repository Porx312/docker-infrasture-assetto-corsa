/**
 * Hub → Convex Host catalog (`battle_cars` / `battle_tracks` / `servers`).
 * See docs/HOST_CATALOG_SYNC.md. Failures are logged; they do not fail hub ops.
 */
import { buildAcstuffJoinUrl } from '@projectd/ac-data-shared/services/acstuffJoinUrl.js';
import { ensureConvexClient } from '@projectd/ac-data-shared/services/convexClient.js';
import {
  resolveFleetEdgeByInstanceId,
  resolveFleetJoinIp,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import {
  getAgentPresence,
  type AgentServerSlot,
} from '../controlApi/agentPresence.js';
import { resolveCoverImageIdForConvex } from './coverUpload.js';
import {
  HOST_CATALOG_MUTATIONS,
  hostCatalogSyncDisableReason,
  isHostCatalogSyncEnabled,
  workerSecret,
} from './env.js';

export { isHostCatalogSyncEnabled, hostCatalogSyncDisableReason } from './env.js';

const CONVEX_REGIONS = new Set(['EU', 'NA', 'SA', 'APAC']);

/**
 * Skins from ZIP-style paths (cars/<slug>/skins/…) or slim-relative (skins/<skinId>/…).
 */
export function extractCarSkinsFromZipPaths(paths: string[], carModel: string): string[] {
  const skins = new Set<string>();
  const re = new RegExp(`(?:^|/)${escapeRegExp(carModel)}/skins/([^/]+)/`, 'i');
  const reCars = new RegExp(`cars/${escapeRegExp(carModel)}/skins/([^/]+)/`, 'i');
  const reSlim = /^skins\/([^/]+)\//i;
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    const m = p.match(reCars) || p.match(re) || p.match(reSlim);
    const skin = m?.[1];
    if (skin && !skin.startsWith('.')) skins.add(skin);
  }
  return [...skins].sort();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TRACK_LAYOUT_SKIP = new Set([
  'ui',
  'data',
  'skins',
  'extension',
  'models',
  'texture',
  'textures',
]);

/**
 * Layout configs from ZIP-style tracks/<slug>/<layout>/ or slim-relative
 * <layout>/data/…, ui/<layout>/….
 */
export function extractTrackConfigsFromZipPaths(paths: string[], track: string): string[] {
  const configs = new Set<string>();
  const reZip = new RegExp(`(?:^|/)tracks/${escapeRegExp(track)}/([^/]+)/`, 'i');
  const reSlimLayoutData = /^([^/]+)\/data\//i;
  const reSlimUiLayout = /^ui\/([^/]+)\//i;
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    const m = p.match(reZip) || p.match(reSlimLayoutData) || p.match(reSlimUiLayout);
    const layout = m?.[1];
    if (layout && !layout.startsWith('.') && !TRACK_LAYOUT_SKIP.has(layout.toLowerCase())) {
      configs.add(layout);
    }
  }
  return [...configs].sort();
}

/** Host Convex catalog provenance (`battle_cars` / `battle_tracks`). */
export type HostCatalogModSource = 'catalog' | 'community' | 'user';

export type HostCatalogUpsertInput = {
  kind: ModKind;
  displayName: string;
  acContentSlug: string;
  zipPaths?: string[];
  manifest?: ModManifest;
  /** Hub mod-previews filename → public URL as `coverImageId`. */
  coverImageFilename?: string | null;
  /** Public hub `/mods/images/…` URL when filename is unavailable. */
  coverImageUrl?: string | null;
  /** Public cover URL (or legacy value); used as-is when set. */
  coverImageId?: string | null;
  /** Official ProjectD catalog vs community/user; Host mutations should persist. */
  source?: HostCatalogModSource;
};

export type HostCatalogDeleteInput = {
  kind: ModKind;
  acContentSlug: string;
  displayName?: string;
};

/** Normalize to Convex region enum; fallback HOST_CATALOG_DEFAULT_REGION or EU. */
export function resolveHostCatalogRegion(raw?: string | null): string {
  const fromEnv = (process.env.HOST_CATALOG_DEFAULT_REGION || '').trim().toUpperCase();
  const candidate = (raw || '').trim().toUpperCase() || fromEnv || 'EU';
  if (CONVEX_REGIONS.has(candidate)) return candidate;
  // Map common labels (e.g. fleet "EU-West" → EU)
  for (const r of CONVEX_REGIONS) {
    if (candidate.startsWith(r)) return r;
  }
  return 'EU';
}

/** Pure args for car upsert (workerSecret added at call site). */
export function buildCarUpsertArgs(input: {
  carModel: string;
  name: string;
  paths?: string[];
  /** Public hub URL; omit when null/empty — Host UI uses placeholder. */
  coverImageId?: string | null;
  source?: HostCatalogModSource;
}): Record<string, unknown> {
  const skins = extractCarSkinsFromZipPaths(input.paths ?? [], input.carModel);
  const coverImageId = (input.coverImageId || '').trim();
  return {
    carModel: input.carModel,
    name: input.name,
    ...(skins.length ? { skins } : {}),
    ...(coverImageId ? { coverImageId } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
}

/** Pure args for track upsert — configTrack always present (Convex required). */
export function buildTrackUpsertArgs(input: {
  track: string;
  name: string;
  paths?: string[];
  /** Public hub URL; omit when null/empty — Host UI uses placeholder. */
  coverImageId?: string | null;
  source?: HostCatalogModSource;
}): Record<string, unknown> {
  const layouts = extractTrackConfigsFromZipPaths(input.paths ?? [], input.track);
  const coverImageId = (input.coverImageId || '').trim();
  return {
    track: input.track,
    name: input.name,
    configTrack: layouts.length ? layouts : ['default'],
    ...(coverImageId ? { coverImageId } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
}

/**
 * Pure args for server folder upsert (presence discovery).
 * Do not set isActive — Convex create forces false; updates omit unless start/stop.
 * `linkServers` must be a full acstuff join URL when present.
 */
export function buildServerUpsertArgs(input: {
  instanceId: string;
  name: string;
  region?: string | null;
  vpsLabel?: string | null;
  linkServers?: string | null;
  /** Public join IP + HTTP_PORT → acstuff URL when both present. */
  joinIp?: string | null;
  httpPort?: number | null;
}): Record<string, unknown> {
  const args: Record<string, unknown> = {
    instanceId: input.instanceId,
    name: input.name,
    region: resolveHostCatalogRegion(input.region),
  };
  const label = (input.vpsLabel || '').trim();
  if (label) args.vpsLabel = label;
  const explicit = (input.linkServers || '').trim();
  const fromPorts = buildAcstuffJoinUrl(input.joinIp, input.httpPort);
  const link = explicit || fromPorts || '';
  if (link) args.linkServers = link;
  return args;
}

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

function fleetHintsForInstance(instanceId: string): {
  region?: string;
  vpsLabel?: string;
  joinIp?: string;
} {
  const edge = resolveFleetEdgeByInstanceId(instanceId);
  if (!edge) return {};
  const joinIp = resolveFleetJoinIp(edge);
  return {
    region: resolveHostCatalogRegion(edge.label),
    vpsLabel: edge.label,
    ...(joinIp ? { joinIp } : {}),
  };
}

function httpPortForFolder(
  slots: AgentServerSlot[],
  folder: string,
): number | null {
  const slot = slots.find((s) => folderName(s) === folder);
  const port = slot?.httpPort;
  if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
    return Math.trunc(port);
  }
  return null;
}

/** Pure plan: which folder names to upsert / delete. */
export function planServerPresenceSync(input: {
  previous: AgentServerSlot[];
  current: AgentServerSlot[];
  /** When true, upsert every current folder (backfill). */
  force?: boolean;
}): { toUpsert: string[]; toDelete: string[] } {
  const prevNames = new Set(
    input.previous.map(folderName).filter((n): n is string => Boolean(n)),
  );
  const currNames = new Set(
    input.current.map(folderName).filter((n): n is string => Boolean(n)),
  );
  const added = [...currNames].filter((n) => !prevNames.has(n));
  const removed = [...prevNames].filter((n) => !currNames.has(n));
  const toUpsert = input.force
    ? [...currNames]
    : prevNames.size === 0 && currNames.size > 0
      ? [...currNames]
      : added;
  return {
    toUpsert: toUpsert.sort(),
    toDelete: input.force ? [] : removed.sort(),
  };
}

export type SyncHostCatalogServersResult = {
  upserted: string[];
  deleted: string[];
  errors: string[];
};

/**
 * Diff previous vs current agent servers[] and upsert/delete Convex `servers` rows.
 * Default: only when the set of folder names changes (not every heartbeat).
 * `force: true`: upsert all current folders (backfill / re-sync).
 */
export async function syncHostCatalogServersFromPresence(input: {
  instanceId: string;
  previous: AgentServerSlot[];
  current: AgentServerSlot[];
  /** From agent presence / AC_REGION when available. */
  region?: string;
  force?: boolean;
}): Promise<SyncHostCatalogServersResult> {
  const empty: SyncHostCatalogServersResult = { upserted: [], deleted: [], errors: [] };
  if (!isHostCatalogSyncEnabled()) {
    return empty;
  }
  const instanceId = input.instanceId.trim();
  if (!instanceId) {
    return empty;
  }

  const { toUpsert, toDelete } = planServerPresenceSync({
    previous: input.previous,
    current: input.current,
    force: input.force,
  });

  if (toUpsert.length === 0 && toDelete.length === 0) {
    return empty;
  }

  const fleet = fleetHintsForInstance(instanceId);
  const region = input.region?.trim() || fleet.region;

  const upsertPath = HOST_CATALOG_MUTATIONS.upsertServer();
  const deletePath = HOST_CATALOG_MUTATIONS.deleteServer();
  const upserted: string[] = [];
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const name of toUpsert) {
    try {
      const args = buildServerUpsertArgs({
        instanceId,
        name,
        region,
        vpsLabel: fleet.vpsLabel,
        joinIp: fleet.joinIp,
        httpPort: httpPortForFolder(input.current, name),
      });
      await runMutation(upsertPath, args);
      upserted.push(name);
      console.log(
        `[host-catalog] upsert server instanceId=${instanceId} name=${name} region=${args.region}${
          args.linkServers ? ` linkServers=${args.linkServers}` : ''
        }`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`upsert ${name}: ${message}`);
      console.warn(`[host-catalog] upsert server failed (${name}): ${message}`);
    }
  }

  for (const name of toDelete) {
    try {
      await runMutation(deletePath, { instanceId, name });
      deleted.push(name);
      console.log(`[host-catalog] delete server instanceId=${instanceId} name=${name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`delete ${name}: ${message}`);
      console.warn(`[host-catalog] delete server failed (${name}): ${message}`);
    }
  }

  return { upserted, deleted, errors };
}

export type HostCatalogSyncResult = {
  synced: boolean;
  error?: string;
};

export async function syncHostCatalogUpsert(
  input: HostCatalogUpsertInput,
): Promise<HostCatalogSyncResult> {
  const disabled = hostCatalogSyncDisableReason();
  if (disabled) {
    console.warn(`[host-catalog] sync disabled (${input.kind}/${input.acContentSlug}): ${disabled}`);
    return { synced: false, error: disabled };
  }
  if (input.kind !== 'car' && input.kind !== 'track') {
    return { synced: false, error: `kind ${input.kind} is not synced to Convex` };
  }
  const slug = input.acContentSlug.trim();
  if (!slug) {
    return { synced: false, error: 'acContentSlug empty' };
  }
  const paths = input.zipPaths?.length ? input.zipPaths : (input.manifest?.rootPaths ?? []);
  const coverImageId = resolveCoverImageIdForConvex({
    coverImageFilename: input.coverImageFilename,
    coverImageUrl: input.coverImageUrl,
    coverImageId: input.coverImageId,
  });

  try {
    if (input.kind === 'car') {
      const args = buildCarUpsertArgs({
        carModel: slug,
        name: input.displayName,
        paths,
        coverImageId,
        source: input.source,
      });
      await runMutation(HOST_CATALOG_MUTATIONS.upsertCar(), args);
      const skinCount = Array.isArray(args.skins) ? args.skins.length : 0;
      console.log(
        `[host-catalog] upsert car carModel=${slug}${skinCount ? ` skins=${skinCount}` : ''}${
          coverImageId ? ' cover=yes' : ''
        }${input.source ? ` source=${input.source}` : ''}`,
      );
      return { synced: true };
    }

    const args = buildTrackUpsertArgs({
      track: slug,
      name: input.displayName,
      paths,
      coverImageId,
      source: input.source,
    });
    await runMutation(HOST_CATALOG_MUTATIONS.upsertTrack(), args);
    const layouts = args.configTrack as string[];
    console.log(
      `[host-catalog] upsert track track=${slug} layouts=${layouts.length}${
        coverImageId ? ' cover=yes' : ''
      }${input.source ? ` source=${input.source}` : ''}`,
    );
    return { synced: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[host-catalog] upsert failed (${input.kind}/${slug}): ${message}`);
    return { synced: false, error: message };
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

export type BackfillHostCatalogServersResult = SyncHostCatalogServersResult & {
  instanceId: string;
  ok: boolean;
  error?: string;
};

/**
 * Force-upsert all servers for one VPS.
 * Prefer explicit `servers` from edge disk scan; else Redis agent presence.
 */
export async function backfillHostCatalogServers(input: {
  instanceId: string;
  region?: string;
  servers?: AgentServerSlot[];
}): Promise<BackfillHostCatalogServersResult> {
  const instanceId = input.instanceId.trim();
  if (!instanceId) {
    return {
      ok: false,
      instanceId: '',
      upserted: [],
      deleted: [],
      errors: [],
      error: 'instanceId_required',
    };
  }
  if (!isHostCatalogSyncEnabled()) {
    const reason = hostCatalogSyncDisableReason() || 'host_catalog_sync_disabled';
    return {
      ok: false,
      instanceId,
      upserted: [],
      deleted: [],
      errors: [],
      error: reason,
    };
  }

  let current = input.servers;
  let region = input.region?.trim();
  if (!current?.length) {
    const presence = await getAgentPresence(instanceId);
    if (!presence?.servers?.length) {
      return {
        ok: false,
        instanceId,
        upserted: [],
        deleted: [],
        errors: [],
        error: 'no_servers_in_body_or_presence',
      };
    }
    current = presence.servers;
    region = region || presence.region;
  }

  const result = await syncHostCatalogServersFromPresence({
    instanceId,
    previous: [],
    current,
    region,
    force: true,
  });
  return {
    ok: result.errors.length === 0,
    instanceId,
    ...result,
  };
}
