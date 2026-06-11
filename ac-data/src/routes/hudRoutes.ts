import { Router, type Request, type Response } from 'express';
import { getSessionCached, getPlayerCached, getTop10Cached } from '../services/hud/lapCompletedHudRefresh.js';

const router = Router();

function requireString(value: unknown, _name: string): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseSteamIds(value: unknown): string[] | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

function handleHudError(res: Response, err: unknown): void {
  console.error('[hud-routes] error:', err);
  res.status(502).json({ error: 'HUD data unavailable' });
}

router.get('/top10', async (req: Request, res: Response) => {
  const serverName = requireString(req.query.serverName, 'serverName');
  const track = requireString(req.query.track, 'track');
  if (!serverName || !track) {
    res.status(400).json({ error: 'serverName and track are required' });
    return;
  }

  const trackConfig = optionalString(req.query.trackConfig);
  const car = optionalString(req.query.car) ?? 'global';

  try {
    const top10 = await getTop10Cached({ serverName, track, trackConfig, car });
    res.json(top10);
  } catch (err) {
    handleHudError(res, err);
  }
});

router.get('/player', async (req: Request, res: Response) => {
  const steamId = requireString(req.query.steamId, 'steamId');
  const serverName = requireString(req.query.serverName, 'serverName');
  const track = requireString(req.query.track, 'track');
  if (!steamId || !serverName || !track) {
    res.status(400).json({ error: 'steamId, serverName and track are required' });
    return;
  }

  const trackConfig = optionalString(req.query.trackConfig);
  const carModel = optionalString(req.query.carModel);

  try {
    const result = await getPlayerCached({ steamId, serverName, track, trackConfig, carModel });
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    handleHudError(res, err);
  }
});

router.get('/session', async (req: Request, res: Response) => {
  const serverName = requireString(req.query.serverName, 'serverName');
  const track = requireString(req.query.track, 'track');
  const steamIds = parseSteamIds(req.query.steamIds);
  if (!serverName || !track || !steamIds) {
    res.status(400).json({ error: 'serverName, track and steamIds are required' });
    return;
  }

  const trackConfig = optionalString(req.query.trackConfig);
  const carFilter = optionalString(req.query.carFilter);
  const carModel = optionalString(req.query.carModel);

  try {
    const top10 = await getTop10Cached({
      serverName,
      track,
      trackConfig,
      car: carFilter ?? 'global',
    });

    const players = await Promise.all(
      steamIds.map(async (steamId) => {
        const session = await getSessionCached({
          steamId,
          serverName,
          track,
          trackConfig,
          carFilter,
          carModel,
        });
        if (!session.ok) {
          return { steamId, ok: false as const, reason: session.reason };
        }
        return {
          steamId,
          ok: true as const,
          context: session.context,
          profile: session.profile,
        };
      }),
    );

    res.json({
      ok: true,
      version: top10.version,
      leaderboard: {
        title: 'Top 10',
        map: top10.track_name,
        layout: top10.layout_name,
        filters: top10.filters,
        entries: top10.entries,
      },
      players,
    });
  } catch (err) {
    handleHudError(res, err);
  }
});

export default router;
