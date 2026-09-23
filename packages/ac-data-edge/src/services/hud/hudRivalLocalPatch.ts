import {
  buildPlayerCacheKey,
  buildSessionCacheKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import {
  getSessionCached,
  peekSessionCache,
  persistPlayerCacheResult,
  persistSessionCacheResult,
} from './lapCompletedHudRefresh.js';
import { playerResultFromSession } from './hudProfile.js';
import type { HudProfile, HudRival } from './hudTypes.js';

export type LapAuthorPb = {
  steamId: string;
  lapTimeMs: number;
};

type RivalSlot = 'above' | 'below';

function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left.length > 0 && left === right;
}

function rivalSteamId(rival: HudRival): string {
  const extended = rival as HudRival & { steam_id?: string; steamId?: string };
  return (extended.steam_id ?? extended.steamId ?? '').trim();
}

export function rivalMatchesAuthor(
  rival: HudRival | null,
  authorSteamId: string,
  authorName: string,
): boolean {
  if (!rival) {
    return false;
  }
  const rivalSid = rivalSteamId(rival);
  if (rivalSid !== '' && rivalSid === authorSteamId.trim()) {
    return true;
  }
  return authorName.trim() !== '' && namesMatch(rival.name, authorName);
}

export function findRivalSlot(
  profile: HudProfile,
  authorSteamId: string,
  authorName: string,
): RivalSlot | null {
  if (rivalMatchesAuthor(profile.rivals.above, authorSteamId, authorName)) {
    return 'above';
  }
  if (rivalMatchesAuthor(profile.rivals.below, authorSteamId, authorName)) {
    return 'below';
  }
  return null;
}

/** True when a rival PB may reorder ranks or shift the rivals window for this observer. */
export function needsRankRecompute(
  profile: HudProfile,
  authorSteamId: string,
  authorName: string,
  lapTimeMs: number,
): boolean {
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) {
    return false;
  }

  if (findRivalSlot(profile, authorSteamId, authorName)) {
    // Rival already in above/below slot — lap_ms patch is enough; observer rank unchanged.
    return false;
  }

  if (profile.best_lap_ms > 0 && lapTimeMs < profile.best_lap_ms) {
    return true;
  }

  const above = profile.rivals.above;
  if (above && above.lap_ms > 0 && lapTimeMs < above.lap_ms) {
    return true;
  }

  return false;
}

export function patchRivalLapInProfile(
  profile: HudProfile,
  slot: RivalSlot,
  lapTimeMs: number,
): HudProfile | null {
  const rival = slot === 'above' ? profile.rivals.above : profile.rivals.below;
  if (!rival) {
    return null;
  }
  if (rival.lap_ms > 0 && lapTimeMs >= rival.lap_ms) {
    return null;
  }

  const updatedRival: HudRival = { ...rival, lap_ms: lapTimeMs };
  const rivals = {
    ...profile.rivals,
    [slot]: updatedRival,
  };
  return { ...profile, rivals };
}

export async function resolveAuthorName(authorSteamId: string): Promise<string> {
  const session = await peekSessionCache({ steamId: authorSteamId });
  if (session?.ok && session.profile?.name) {
    return session.profile.name;
  }
  return '';
}

/** Apply rival PB lap_ms patches to observer session cache (no Convex). Returns true if profile changed. */
export async function patchObserverRivalPbs(
  observerSteamId: string,
  authors: LapAuthorPb[],
  authorNames: Map<string, string>,
): Promise<boolean> {
  const session = await getSessionCached({ steamId: observerSteamId });
  if (!session.ok || !session.profile) {
    return false;
  }

  let profile = session.profile;
  let changed = false;

  for (const author of authors) {
    const authorName = authorNames.get(author.steamId) ?? '';
    const slot = findRivalSlot(profile, author.steamId, authorName);
    if (!slot) {
      continue;
    }
    const patched = patchRivalLapInProfile(profile, slot, author.lapTimeMs);
    if (patched) {
      profile = patched;
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }

  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId: observerSteamId }));
  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId: observerSteamId }));
  const updatedSession = { ...session, profile };
  const updatedPlayer = playerResultFromSession(updatedSession);
  await persistSessionCacheResult(sessionKey, updatedSession);
  await persistPlayerCacheResult(playerKey, updatedPlayer);
  return true;
}

export async function buildAuthorNameMap(authors: LapAuthorPb[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    authors.map(async (author) => {
      names.set(author.steamId, await resolveAuthorName(author.steamId));
    }),
  );
  return names;
}

export function observerNeedsConvexRefresh(
  profile: HudProfile,
  authors: LapAuthorPb[],
  authorNames: Map<string, string>,
): boolean {
  return authors.some((author) =>
    needsRankRecompute(
      profile,
      author.steamId,
      authorNames.get(author.steamId) ?? '',
      author.lapTimeMs,
    ),
  );
}
