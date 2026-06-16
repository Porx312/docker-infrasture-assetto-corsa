import { Router, type Request, type Response } from 'express';
import {
  buildSessionVpsResponse,
  mapPlayerResultToSessionPlayer,
} from '../services/hud/hudSessionResponse.js';
import { getPlayerCached, getTop10Cached } from '../services/hud/lapCompletedHudRefresh.js';
import { normalizeHudQuery } from '../services/hud/hudQueryNormalize.js';
import {
  combineSessionVersion,
  readLbVersion,
  readPlayerVersion,
} from '../services/hud/hudVersion.js';
import type { HudPlayerErr, HudSessionVpsErr } from '../services/hud/hudTypes.js';

const router = Router();

const GLOBAL_PLAYER_ERRORS = new Set<HudPlayerErr['reason']>([
  'server_not_found',
  'track_not_found',
]);

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

function respondHudErr(res: Response, body: HudSessionVpsErr): void {
  res.status(404).json(body);
}

function parseHudLocation(req: Request): NormalizedHudLocation | null {
  const serverName = requireString(req.query.serverName, 'serverName');
  const track = requireString(req.query.track, 'track');
  if (!serverName || !track) {
    return null;
  }
  const trackConfig = optionalString(req.query.trackConfig);
  return normalizeHudQuery(serverName, track, trackConfig);
}

type NormalizedHudLocation = ReturnType<typeof normalizeHudQuery>;

router.get('/version', async (req: Request, res: Response) => {
  const location = parseHudLocation(req);
  if (!location) {
    res.status(400).json({ error: 'serverName and track are required' });
    return;
  }

  const car = optionalString(req.query.car) ?? optionalString(req.query.carFilter) ?? 'global';
  const steamIds = parseSteamIds(req.query.steamIds) ?? [];

  try {
    const lbVersion = await readLbVersion({
      serverName: location.serverName,
      track: location.track,
      trackConfig: location.trackConfig,
      car,
    });

    const carModel = optionalString(req.query.carModel);
    const playerVersions = await Promise.all(
      steamIds.map((steamId) =>
        readPlayerVersion({
          steamId,
          serverName: location.serverName,
          track: location.track,
          trackConfig: location.trackConfig,
          carModel,
        }),
      ),
    );

    const version =
      steamIds.length > 0
        ? combineSessionVersion(lbVersion, playerVersions)
        : (lbVersion ?? '0');

    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      ok: true,
      version,
      lbVersion: lbVersion ?? '0',
      playerVersions: Object.fromEntries(
        steamIds.map((steamId, index) => [steamId, playerVersions[index] ?? '0']),
      ),
    });
  } catch (err) {
    handleHudError(res, err);
  }
});

router.get('/top10', async (req: Request, res: Response) => {
  const location = parseHudLocation(req);
  if (!location) {
    res.status(400).json({ error: 'serverName and track are required' });
    return;
  }

  const car = optionalString(req.query.car) ?? 'global';

  try {
    const top10 = await getTop10Cached({
      serverName: location.serverName,
      track: location.track,
      trackConfig: location.trackConfig,
      car,
    });
    if (!top10.ok) {
      respondHudErr(res, top10);
      return;
    }
    res.json(top10);
  } catch (err) {
    handleHudError(res, err);
  }
});

router.get('/player', async (req: Request, res: Response) => {
  const steamId = requireString(req.query.steamId, 'steamId');
  const location = parseHudLocation(req);
  if (!steamId || !location) {
    res.status(400).json({ error: 'steamId, serverName and track are required' });
    return;
  }

  const carModel = optionalString(req.query.carModel);

  try {
    const result = await getPlayerCached({
      steamId,
      serverName: location.serverName,
      track: location.track,
      trackConfig: location.trackConfig,
      carModel,
    });
    if (!result.ok) {
      respondHudErr(res, result);
      return;
    }
    res.json(result);
  } catch (err) {
    handleHudError(res, err);
  }
});

router.get('/session', async (req: Request, res: Response) => {
  const location = parseHudLocation(req);
  const steamIds = parseSteamIds(req.query.steamIds);
  if (!location || !steamIds) {
    res.status(400).json({ error: 'serverName, track and steamIds are required' });
    return;
  }

  const carFilter = optionalString(req.query.carFilter);
  const carModel = optionalString(req.query.carModel);

  try {
    const top10 = await getTop10Cached({
      serverName: location.serverName,
      track: location.track,
      trackConfig: location.trackConfig,
      car: carFilter ?? 'global',
    });
    if (!top10.ok) {
      respondHudErr(res, top10);
      return;
    }

    const playerResults = await Promise.all(
      steamIds.map(async (steamId) => {
        const player = await getPlayerCached({
          steamId,
          serverName: location.serverName,
          track: location.track,
          trackConfig: location.trackConfig,
          carModel,
        });
        return { steamId, player };
      }),
    );

    const globalFailure = playerResults.find(
      ({ player }) => !player.ok && GLOBAL_PLAYER_ERRORS.has(player.reason),
    );
    if (globalFailure && !globalFailure.player.ok) {
      respondHudErr(res, { ok: false, reason: globalFailure.player.reason });
      return;
    }

    const players = playerResults.map(({ steamId, player }) =>
      mapPlayerResultToSessionPlayer(steamId, top10, location.track, carModel, player),
    );

    const lbVersion = await readLbVersion({
      serverName: location.serverName,
      track: location.track,
      trackConfig: location.trackConfig,
      car: carFilter ?? 'global',
    });
    const playerVersions = await Promise.all(
      steamIds.map((steamId) =>
        readPlayerVersion({
          steamId,
          serverName: location.serverName,
          track: location.track,
          trackConfig: location.trackConfig,
          carModel,
        }),
      ),
    );
    const version = combineSessionVersion(lbVersion, playerVersions);

    res.setHeader('ETag', `"${version}"`);
    res.json({ ...buildSessionVpsResponse(top10, players), version });
  } catch (err) {
    handleHudError(res, err);
  }
});

export default router;
