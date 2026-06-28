import type { HudProfile, HudRival, HudRivals } from './hudTypes.js';

const EMPTY_RIVALS: HudRivals = { above: null, below: null };

function readNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function readString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function coerceHudRival(raw: unknown): HudRival | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as Record<string, unknown>;
  return {
    rank: readNumber(source, 'rank'),
    name: readString(source, 'name'),
    tier: readNumber(source, 'tier'),
    lap_ms: readNumber(source, 'lap_ms', 'lapMs'),
    car_name: readString(source, 'car_name', 'carName'),
    ...(readString(source, 'avatar_url', 'avatarUrl')
      ? { avatar_url: readString(source, 'avatar_url', 'avatarUrl') }
      : {}),
  };
}

function coerceHudRivals(raw: unknown): HudRivals {
  if (!raw || typeof raw !== 'object') {
    return EMPTY_RIVALS;
  }
  const source = raw as Record<string, unknown>;
  return {
    above: coerceHudRival(source.above),
    below: coerceHudRival(source.below),
  };
}

/** Map Convex profile (snake_case or camelCase) to the HUD wire format. */
export function coerceHudProfile(
  raw: HudProfile | Record<string, unknown> | null | undefined,
): HudProfile | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const rivals = coerceHudRivals(source.rivals);
  const profile: HudProfile = {
    name: readString(source, 'name'),
    rank: readNumber(source, 'rank'),
    tier: readNumber(source, 'tier'),
    best_lap_ms: readNumber(source, 'best_lap_ms', 'bestLapMs', 'bestLap'),
    car_name: readString(source, 'car_name', 'carName'),
    car_id: readString(source, 'car_id', 'carId'),
    steam_id: readString(source, 'steam_id', 'steamId'),
    rivals,
  };

  const elo = readNumber(source, 'elo');
  if (elo > 0) {
    profile.elo = elo;
  }

  const avatarUrl = readString(source, 'avatar_url', 'avatarUrl');
  if (avatarUrl) {
    profile.avatar_url = avatarUrl;
  }

  if (source.isInvalidated === true) {
    profile.isInvalidated = true;
  }

  return profile;
}

export function isProfileInvalidated(profile: HudProfile | null | undefined): boolean {
  return profile?.isInvalidated === true;
}

/** ac-data adds `rival = rivals.above` for legacy HUD overlays; Convex only sends `rivals`. */
export function normalizeHudProfile(
  raw: HudProfile | Record<string, unknown> | null | undefined,
): HudProfile | null {
  const profile = coerceHudProfile(raw);
  if (!profile) {
    return null;
  }

  const rivals = profile.rivals ?? EMPTY_RIVALS;
  const legacyRival =
    raw && typeof raw === 'object' ? coerceHudRival((raw as Record<string, unknown>).rival) : null;
  const rival: HudRival | null = rivals.above ?? legacyRival ?? profile.rival ?? null;

  return {
    ...profile,
    rivals,
    rival,
  };
}

/** Session has rivals; player cache often has fresher tier/best_lap_ms for the combo. */
export function mergeSessionProfileFields(
  sessionProfile: HudProfile | Record<string, unknown> | null | undefined,
  playerProfile: HudProfile | Record<string, unknown> | null | undefined,
): HudProfile | null {
  const session = sessionProfile ? normalizeHudProfile(sessionProfile) : null;
  const player = playerProfile ? normalizeHudProfile(playerProfile) : null;

  if (!session && !player) {
    return null;
  }
  if (!session) {
    return player;
  }
  if (!player) {
    return session;
  }

  const sessionHasRivals = Boolean(session.rivals.above || session.rivals.below);

  return normalizeHudProfile({
    ...session,
    name: session.name || player.name,
    steam_id: session.steam_id || player.steam_id,
    car_id: session.car_id || player.car_id,
    car_name: session.car_name || player.car_name,
    rank: session.rank > 0 ? session.rank : player.rank,
    tier: player.tier > 0 ? player.tier : session.tier,
    best_lap_ms: player.best_lap_ms > 0 ? player.best_lap_ms : session.best_lap_ms,
    elo: session.elo ?? player.elo,
    avatar_url: session.avatar_url ?? player.avatar_url,
    isInvalidated: session.isInvalidated === true || player.isInvalidated === true,
    rivals: sessionHasRivals ? session.rivals : player.rivals,
  });
}
