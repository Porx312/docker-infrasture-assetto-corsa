# Convex: `getPlayerJoinContext` (worker query)

ac-data calls this **once per `player_join`** to sync ban state and seed HUD Redis cache. No polling.

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
- Writes `ac:hud:session:*` and derives `ac:hud:player:*` from `session.profile`
- SSE push reads cache (`preferCachedSession`) — no extra Convex HUD fetch on join

### Push HUD when Convex invalidates / re-validates (mid-session)

When an admin toggles `users.isInvalidated` in Convex, call ac-data so connected overlays receive SSE immediately (without waiting for reconnect or lap):

```http
POST http://AC_DATA_HOST:3000/hud/worker/refresh-user
Content-Type: application/json

{
  "workerSecret": "<CONVEX_WORKER_SECRET>",
  "steamId": "76561199230780195"
}
```

Header alternative: `X-Worker-Secret: <CONVEX_WORKER_SECRET>`

ac-data runs `getPlayerJoinContext` → updates Redis ban + HUD cache → pushes `hud_error` (`user_invalidated`) or `hud_version` + `hud_session` (re-validated).

**Convex (ProjectD)** — schedule from the mutation that sets `isInvalidated`:

```typescript
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const notifyAcDataHudRefresh = internalAction({
  args: { steamId: v.string() },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const baseUrl = process.env.AC_DATA_BASE_URL;
    const workerSecret = process.env.CONVEX_WORKER_SECRET;
    if (!baseUrl || !workerSecret) {
      console.warn("[hud] AC_DATA_BASE_URL or CONVEX_WORKER_SECRET missing");
      return null;
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/hud/worker/refresh-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerSecret, steamId: args.steamId.trim() }),
    });
    if (!response.ok) {
      console.warn("[hud] ac-data refresh-user failed", await response.text());
    }
    return null;
  },
});
```

In the user invalidate/revalidate mutation:

```typescript
await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataHudRefresh, {
  steamId: user.steamId,
});
```

Set `AC_DATA_BASE_URL` in the Convex dashboard (e.g. `http://127.0.0.1:3000` dev, prod URL on VPS).

## Verify (assetto-infra only)

```bash
cd ac-data && npm run build

./scripts/verify-convex-player-join.sh STEAM_ID
./scripts/verify-convex-player-join.sh --expect-invalidated STEAM_BANEADO_OFFLINE
./scripts/verify-convex-hud-session.sh STEAM_CONECTADO
./scripts/verify-user-ban-pipeline.sh STEAM_ID
```

After Convex deploy + `./stop.sh && ./start.sh dev`, connect with a banned user and confirm:

```bash
redis-cli GET "ac:user:invalidated:STEAM_ID"   # "1"
tail -f ac-data.log   # [player-join] invalidated=true, [user-ban] marked
```
