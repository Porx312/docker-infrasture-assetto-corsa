# Convex: push sync to ac-data (`refresh-user`)

When user state changes in Convex while the player is **already connected**, schedule ac-data refresh immediately. `player_join` remains a **fallback** only (reconnect, webhook failure, VPS unreachable).

## Endpoint (ac-data)

```http
POST http://AC_DATA_HOST:3000/hud/worker/refresh-user
Content-Type: application/json

{
  "workerSecret": "<CONVEX_WORKER_SECRET>",
  "steamId": "76561199230780195",
  "reason": "invalidated"
}
```

Optional `reason` for logs and push behavior: `"invalidated"`, `"registered"`, `"prefs"`, `"revalidated"`, `"cosmetics"`, `"lap_pb"`, `"rival_pb"`, `"session"`.

Header alternative: `X-Worker-Secret: <CONVEX_WORKER_SECRET>`

## What ac-data does

1. Calls `getPlayerJoinContext`
2. Updates Redis: ban, not-registered, HUD caches, `ac:user:prefs:*`, `ac:user:profile:cosmetics_fp:*`
3. Pushes SSE to connected HUD clients (`lap_pb` / `rival_pb` / `session` / `cosmetics` use live `getHudSession`)
4. **`publishEnforcement: true`** — pub/sub kick for ban / `user_not_found` on all servers (mid-session)

`player_join` uses the same refresh path with **`publishEnforcement: false`** (deferred kick on connect avoids pub/sub race).

## Convex: schedule from every relevant mutation

Use one internal action (extend args with optional `reason`):

```typescript
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const notifyAcDataHudRefresh = internalAction({
  args: {
    steamId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const baseUrl = process.env.AC_DATA_BASE_URL;
    const workerSecret = process.env.CONVEX_WORKER_SECRET;
    if (!baseUrl || !workerSecret) {
      console.warn("[hud] AC_DATA_BASE_URL or CONVEX_WORKER_SECRET missing");
      return null;
    }
    const body: Record<string, string> = {
      workerSecret,
      steamId: args.steamId.trim(),
    };
    if (args.reason?.trim()) {
      body.reason = args.reason.trim();
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/hud/worker/refresh-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.warn("[hud] ac-data refresh-user failed", await response.text());
    }
    return null;
  },
});
```

| Mutation (ProjectD) | Schedule refresh |
|---------------------|------------------|
| Admin sets `users.isInvalidated` true/false | `{ steamId, reason: "invalidated" }` or `"revalidated"` |
| User links Steam / account created | `{ steamId, reason: "registered" }` |
| `users:updatePrivacyPrefs` (`saveTime` / `acceptBattle`) | `{ steamId, reason: "prefs" }` |
| Equip frame / update `display_style` | `{ steamId, reason: "cosmetics" }` |
| Lap ingest (PB or rank/rivals change) | `{ steamId, reason: "lap_pb" }` for author |
| Lap ingest (rival window affected) | `{ steamId, reason: "rival_pb" }` for each observer |

See [`CONVEX_LAP_HUD_PUSH.md`](CONVEX_LAP_HUD_PUSH.md) for lap/rival notify targets and ProjectD implementation.

Example in privacy prefs mutation:

```typescript
await ctx.db.patch(userId, { saveTime: args.saveTime, acceptBattle: args.acceptBattle });
const user = await ctx.db.get(userId);
if (user?.steamId) {
  await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataHudRefresh, {
    steamId: user.steamId,
    reason: "prefs",
  });
}
```

Example in profile cosmetics mutation:

```typescript
await ctx.db.patch(userId, { equippedFrameId: args.frameId /* + display style fields */ });
const user = await ctx.db.get(userId);
if (user?.steamId) {
  await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataHudRefresh, {
    steamId: user.steamId,
    reason: "cosmetics",
  });
}
```

Env in Convex dashboard: `AC_DATA_BASE_URL`, `CONVEX_WORKER_SECRET` (same as worker queries).

## Mid-session behavior (no reconnect)

| User action (web) | Effect |
|-------------------|--------|
| Ban / invalidation | Kick ~3s on current server + SSE `hud_error` |
| Steam link / register | Clears `not_registered`; can keep playing |
| `saveTime=false` | Next lap skips Convex ingest; HUD local OK |
| `acceptBattle=false` | No **new** battles; active battle continues until FINISHED |
| `acceptBattle` / `saveTime` toggle | Private in-game chat to that player only (one message per pref changed) |
| Equip frame / change display style | SSE `hud_session` with new `display_style` / `frame_url` (HUD only, no chat) |
| Steam link / register | Clears `not_registered` + welcome chat; **no** kick |

See also [`telemetry-data/REDIS_CONTRACT.md`](../telemetry-data/REDIS_CONTRACT.md) pub/sub `ac:user:prefs:notify` and `ac:user:registered`.

See also [`CONVEX_PLAYER_JOIN_CONTEXT.md`](CONVEX_PLAYER_JOIN_CONTEXT.md), [`CONVEX_USER_PREFS.md`](CONVEX_USER_PREFS.md), [`CONVEX_PROFILE_COSMETICS.md`](CONVEX_PROFILE_COSMETICS.md).

## ProjectD deployment checklist

Convex lives in **ProjectD** (not this repo). After merging ac-data/telemetry changes:

1. Deploy `notifyAcDataHudRefresh` internal action (see above) if not already in ProjectD
2. Wire `ctx.scheduler.runAfter(0, internal.*.notifyAcDataHudRefresh, …)` on:
   - `users.isInvalidated` toggle → `reason: "invalidated"` or `"revalidated"`
   - Steam link / account created → `reason: "registered"`
   - Privacy prefs mutation → `reason: "prefs"`
   - Profile cosmetics (frame / display style) → `reason: "cosmetics"` (bump `session.version` in Convex)
3. Set **Convex dashboard** env (not VPS `.env.local`):
   - `AC_DATA_BASE_URL` — public URL to ac-data (e.g. `https://dev-api.projectd.space` from `STAGING_API_HOST`; **not** `127.0.0.1:3000`)
   - `CONVEX_WORKER_SECRET` — same value as VPS `.env.local`

Verify from Convex logs: successful `POST …/hud/worker/refresh-user` (no 401/502).

## Troubleshooting: “only works on reconnect”

If ban, registration clear, or pref chat **only** apply after the player leaves and rejoins:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Manual `./scripts/verify-hud-worker-refresh.sh` works in-game | Convex webhook not deployed or env missing | Deploy `notifyAcDataHudRefresh` + dashboard env |
| Manual refresh fails | ac-data unreachable or wrong secret | Check Caddy/TLS, `CONVEX_WORKER_SECRET`, `ac-data.log` |
| Redis updates but no kick/chat | telemetry not subscribed or player has no `car_id` | Restart telemetry; check `telemetry-data.log` for pub/sub |
| Kick delayed ~45s | Old code waited for `client_loaded` on mid-session kick | Ensure telemetry has `wait_client_loaded=False` on pub/sub + CAR_UPDATE kicks |

**Quick test while connected in-game:**

```bash
./scripts/verify-push-sync-live.sh STEAM_ID invalidated
# or: registered / prefs / cosmetics
```

- If manual refresh **works** → fix Convex webhook (`AC_DATA_BASE_URL`, scheduler calls)
- If manual refresh **fails** → fix ac-data / Redis / telemetry on the VPS

Verify: `./scripts/verify-hud-worker-refresh.sh STEAM_ID`, `./scripts/verify-push-sync-live.sh STEAM_ID`
