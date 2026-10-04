/** Optional presence args for Convex HUD session (no live_players required). */

export type HudWorkerPresenceArgs = {
  serverName: string;
  instanceId?: string;
  folderSlug?: string;
  carModel?: string;
  track?: string;
  trackConfig?: string;
};

/** Build Convex `presence` from a Redis / in-memory presence record. */
export function hudWorkerPresenceFromRecord(record: {
  serverName?: string | null;
  instanceId?: string | null;
  folderSlug?: string | null;
  carModel?: string | null;
  track?: string | null;
  trackConfig?: string | null;
}): HudWorkerPresenceArgs | undefined {
  const serverName = typeof record.serverName === 'string' ? record.serverName.trim() : '';
  if (!serverName) {
    return undefined;
  }
  const out: HudWorkerPresenceArgs = { serverName };
  const instanceId = typeof record.instanceId === 'string' ? record.instanceId.trim() : '';
  if (instanceId) out.instanceId = instanceId;
  const folderSlug = typeof record.folderSlug === 'string' ? record.folderSlug.trim() : '';
  if (folderSlug) out.folderSlug = folderSlug;
  const carModel = typeof record.carModel === 'string' ? record.carModel.trim() : '';
  if (carModel) out.carModel = carModel;
  const track = typeof record.track === 'string' ? record.track.trim() : '';
  if (track) out.track = track;
  const trackConfig = typeof record.trackConfig === 'string' ? record.trackConfig.trim() : '';
  if (trackConfig) out.trackConfig = trackConfig;
  return out;
}

/** Parse `presence` from a hub worker JSON body. */
export function readHudWorkerPresenceFromBody(
  body: unknown,
): HudWorkerPresenceArgs | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const raw = (body as { presence?: unknown }).presence;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  return hudWorkerPresenceFromRecord(raw as Record<string, unknown>);
}
