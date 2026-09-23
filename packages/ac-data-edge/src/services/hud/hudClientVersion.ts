import { profileCosmeticsFingerprint } from './hudProfile.js';
import { sessionLeaderboardFingerprint } from './lapCompletedHudRefresh.js';
import type { HudSessionOk, HudVersionOk } from './hudTypes.js';

/** FNV-1a 32-bit — stable numeric playerVersion for HUD clients. */
export function fnv1aHash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

export function buildHudVersionForSession(
  session: HudSessionOk,
  cosmeticsFp?: string,
): HudVersionOk {
  const fp = cosmeticsFp ?? profileCosmeticsFingerprint(session.profile);
  const lbFp = sessionLeaderboardFingerprint(session);
  const playerVersion = fnv1aHash32(`${session.version}|${fp}|${lbFp}`);
  return {
    ok: true,
    version: session.version,
    lbVersion: session.version,
    playerVersion,
  };
}
