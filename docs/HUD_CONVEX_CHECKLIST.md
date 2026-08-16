# ProjectD Convex checklist (external backend)

The ProjectD Convex deployment lives **outside** `assetto-infra`. Use this checklist before production HUD/battle rollout.

## Required queries

| Query | Env var | Purpose |
|-------|---------|---------|
| `workerPlayers:getPlayerJoinContext` | `CONVEX_PLAYER_JOIN_QUERY` | Ban pipeline + HUD cache seed on `player_join` |
| `hud:getHudSession` | `CONVEX_HUD_SESSION_QUERY` | Profile, rank, rivals (SSE `hud_session`) |
| `hud:getHudVersion` | `CONVEX_HUD_VERSION_QUERY` | Version tokens for cache invalidation |

Without `getPlayerJoinContext`, offline banned users may not get `ac:user:invalidated:*` keys. See [`CONVEX_PLAYER_JOIN_CONTEXT.md`](CONVEX_PLAYER_JOIN_CONTEXT.md).

## Stable version strings

Convex `getHudVersion` / session `version` must **not** change on every poll when data is unchanged. Unstable versions cause ac-data to restart AC servers and thrash HUD caches (see `AGENTS.md` gotcha #5).

Verify after deploy:

```bash
./scripts/verify-convex-hud-session.sh YOUR_STEAM_ID
./scripts/verify-convex-hud-version-stable.sh YOUR_STEAM_ID
# Run version-stable twice; version string should be identical when rank/rivals unchanged
```

## Query volume diagnostics (ac-data)

Convex `getHudSession` / `getHudVersion` are called only from **ac-data**, not from the in-game overlay.

| Symptom in Convex dashboard | Likely cause |
|-----------------------------|--------------|
| Steady `getHudVersion` ~12/min/player | Overlay **poll** mode (`GET /hud/snapshot` every 5s) |
| Bursts on lap PB | `lap_completed` refresh + rival fan-out + retries |
| Duplicate session+version pairs | Fixed: pub/sub `bumpPlayerVersion` now uses Redis cache push |

**Measure on VPS:**

```bash
# In-process counters (since ac-data restart)
./scripts/verify-hud-convex-query-volume.sh

# Optional: log every 60s to ac-data.log
HUD_CONVEX_QUERY_LOG_INTERVAL_MS=60000
```

Worker endpoint: `GET /hud/worker/convex-query-stats` (header `X-Worker-Secret`).

See also [`HUD_TIME_ATTACK_INTEGRATION.md`](HUD_TIME_ATTACK_INTEGRATION.md) env table for retry/fan-out tuning.

## Fleet / VPS

Each VPS clone needs a **unique** `AC_INSTANCE_ID` so Redis battle keys and HUD consumers do not collide. See [`VPS_FLEET_SETUP.md`](VPS_FLEET_SETUP.md).

```bash
./scripts/verify-vps-instance-config.sh
```

## Staging verification

```bash
# Join context + ban pipeline
./scripts/verify-convex-player-join.sh YOUR_STEAM_ID

# Full HUD stack (local + optional live)
HUD_E2E_SKIP_LIVE=1 ./scripts/verify-hud-e2e.sh YOUR_STEAM_ID
```

## ac-data env (this repo)

Copy from `.env.example` into `.env.local` / `.env.production`:

- `CONVEX_PLAYER_JOIN_QUERY=workerPlayers:getPlayerJoinContext`
- `CONVEX_HUD_SESSION_QUERY=hud:getHudSession`
- `CONVEX_HUD_VERSION_QUERY=hud:getHudVersion`
- `USER_BAN_ENABLED=true`
- `HUD_LAP_RIVAL_FANOUT_ENABLED=true` (only when legacy `HUD_LAP_AC_DATA_REFRESH_ENABLED=true`)
- Lap/rival session push: Convex → `refresh-user` — see [`CONVEX_LAP_HUD_PUSH.md`](CONVEX_LAP_HUD_PUSH.md)
