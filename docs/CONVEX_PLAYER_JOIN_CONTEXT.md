# Convex: `getPlayerJoinContext` (worker query)

ac-data calls `getPlayerJoinContext` on **`player_join`** (fallback) and when Convex pushes **`POST /hud/worker/refresh-user`** (immediate). No polling.

See [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md) for when Convex must schedule refresh.

There is **no separate `getHudPlayer` query**. HUD profile data comes only from `session` (same shape as `hud:getHudSession`). ac-data derives the local Redis key `ac:hud:player:*` from `session.profile`.

## Convex implementation (ProjectD)

| File | Role |
|------|------|
| `convex/lib/hudSessionBundle.ts` | `buildHudSessionForSteamId`, validators, internal leaderboard |
| `convex/lib/hudPlayerJoinContext.ts` | `buildPlayerJoinContext` — user → ban → session |
| `convex/workerPlayers.ts` | `getPlayerJoinContext` export |
| `convex/hud.ts` | Thin `getHudSession` + `getHudVersion` only |

Handler order in `buildPlayerJoinContext`:

1. Validate `workerSecret`
2. Load user by `steamId` → if `users.isInvalidated === true`, return `user_invalidated` **immediately**
3. Else build session via `buildHudSessionForSteamId` (same as `hud:getHudSession`)
4. Return `{ user, session }` only — no `player` field

Ban on session refresh (`getHudSession`): only via `session.profile.isInvalidated` when `session.ok === true`. Do not add `user_invalidated` to session error reasons for early exit on `getHudSession`.

## Env (ac-data)

```bash
CONVEX_PLAYER_JOIN_QUERY=workerPlayers:getPlayerJoinContext
CONVEX_HUD_SESSION_QUERY=hud:getHudSession
CONVEX_HUD_VERSION_QUERY=hud:getHudVersion
USER_BAN_ENABLED=true
```

Remove legacy `CONVEX_HUD_PLAYER_QUERY` if still present in `.env.local`.

## Args

```typescript
{
  workerSecret: string;
  steamId: string;
}
```

## Returns

### User invalidated (check this **before** `live_players`)

```json
{
  "ok": false,
  "reason": "user_invalidated",
  "user": {
    "steamId": "765611992300780195",
    "isInvalidated": true,
    "name": "Pilot"
  }
}
```

### User valid + connected on managed server (HUD data)

```json
{
  "ok": true,
  "user": {
    "steamId": "765611992300780195",
    "isInvalidated": false,
    "name": "Pilot"
  },
  "session": {
    "ok": true,
    "version": "…",
    "context": { "…": "…" },
    "profile": {
      "rank": 1,
      "tier": 2,
      "best_lap_ms": 275432,
      "elo": 1180,
      "saveTime": true,
      "acceptBattle": true,
      "rivals": { "above": { "…": "…" }, "below": { "…": "…" } }
    }
  }
}
```

`session` uses the same shape as `hud:getHudSession`. Do **not** return a separate `player` field.

### User valid but not on managed server

```json
{
  "ok": true,
  "user": { "steamId": "…", "isInvalidated": false },
  "session": { "ok": false, "reason": "player_not_connected" }
}
```

### Unknown steamId

```json
{ "ok": false, "reason": "user_not_found" }
```

## ac-data usage

[`playerJoinContext.ts`](../ac-data/src/services/hud/playerJoinContext.ts):

- `markUserInvalidated` / `clearUserInvalidated` from `user.isInvalidated` or `reason`
- `markUserNotRegistered` / `clearUserNotRegistered` when top-level `reason === user_not_found`
- `syncUserPrefsFromProfile` → `ac:user:prefs:save_time:*` and `ac:user:prefs:accept_battle:*`
- Writes `ac:hud:session:*` and derives `ac:hud:player:*` from `session.profile`
- SSE push reads cache (`preferCachedSession`) — no extra Convex HUD fetch on join

When `user_not_found`, telemetry-data sends a private chat warning then kicks the player from the server
(see [`telemetry-data/REDIS_CONTRACT.md`](../telemetry-data/REDIS_CONTRACT.md)).

### Push user state when Convex changes (mid-session)

When ban, registration, or privacy prefs change while the player is connected, Convex must call ac-data immediately (do not wait for reconnect):

```http
POST http://AC_DATA_HOST:3000/hud/worker/refresh-user
Content-Type: application/json

{
  "workerSecret": "<CONVEX_WORKER_SECRET>",
  "steamId": "76561199230780195",
  "reason": "invalidated"
}
```

Optional `reason`: `"invalidated"`, `"revalidated"`, `"registered"`, `"prefs"` (logging only).

Header alternative: `X-Worker-Secret: <CONVEX_WORKER_SECRET>`

ac-data runs `getPlayerJoinContext` → updates Redis (ban, not-registered, prefs, HUD cache) → pushes SSE → **pub/sub kick** when ban or `user_not_found` (`publishEnforcement: true` on this endpoint only).

Schedule from **every** mutation that changes playable state:

| Event | Call refresh-user |
|-------|-------------------|
| `users.isInvalidated` toggle | Yes |
| Steam link / user registered | Yes |
| `saveTime` / `acceptBattle` toggle | Yes |

Full Convex action + examples: [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md).

Set `AC_DATA_BASE_URL` in the Convex dashboard (e.g. `http://127.0.0.1:3000` dev, prod URL on VPS).

## Verify (assetto-infra only)

```bash
cd ac-data && npm run build

./scripts/verify-convex-player-join.sh STEAM_ID
./scripts/verify-convex-player-join.sh --expect-invalidated STEAM_BANEADO_OFFLINE
./scripts/verify-convex-hud-session.sh STEAM_CONECTADO
./scripts/verify-user-ban-pipeline.sh STEAM_ID
./scripts/verify-user-prefs.sh STEAM_ID
./scripts/verify-hud-worker-refresh.sh STEAM_ID prefs
```

After Convex deploy + `./stop.sh && ./start.sh dev`, connect with a banned user and confirm:

```bash
redis-cli GET "ac:user:invalidated:STEAM_ID"   # "1"
tail -f ac-data.log   # [player-join] invalidated=true, [user-ban] marked
```
