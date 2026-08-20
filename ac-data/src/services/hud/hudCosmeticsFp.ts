import type { Request, Response } from 'express';

import { requireHudApiKeyFromQuery } from './hudBattleAuth.js';
import { isHudSseEnabled } from './battleHudPush.js';
import { normalizeHudProfile } from './hudProfile.js';
import {
  readProfileCosmeticsFingerprint,
  syncProfileCosmeticsFromProfile,
} from './hudProfileCosmetics.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import { isHudRedisConfigured } from './hudRedis.js';

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

/** Redis-only cosmetics fingerprint for lightweight HUD poll (no Convex). */
export async function handleHudProfileCosmeticsFp(req: Request, res: Response): Promise<void> {
  if (!isHudRedisConfigured() || !isHudSseEnabled()) {
    res.status(404).json({ ok: false, reason: 'HUD disabled' });
    return;
  }

  const steamId = requireQueryString(req.query.steamId);
  if (!steamId) {
    res.status(400).json({ ok: false, reason: 'steamId is required' });
    return;
  }

  const auth = requireHudApiKeyFromQuery(req.query.api_key, req.headers['x-api-key']);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  let fingerprint = (await readProfileCosmeticsFingerprint(steamId)) ?? '';
  const cached = await peekSessionCache({ steamId });
  if (cached?.ok && cached.profile) {
    const profile = normalizeHudProfile(cached.profile);
    if (profile) {
      const synced = await syncProfileCosmeticsFromProfile(steamId, profile);
      fingerprint = synced.next;
    }
  }

  res.json({
    ok: true,
    steamId,
    fingerprint,
  });
}
