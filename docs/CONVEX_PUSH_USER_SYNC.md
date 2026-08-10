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

Optional `reason` for logs only: `"invalidated"`, `"registered"`, `"prefs"`, `"revalidated"`.

Header alternative: `X-Worker-Secret: <CONVEX_WORKER_SECRET>`

## What ac-data does

1. Calls `getPlayerJoinContext`
2. Updates Redis: ban, not-registered, HUD caches, `ac:user:prefs:*`
3. Pushes SSE to connected HUD clients
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

Env in Convex dashboard: `AC_DATA_BASE_URL`, `CONVEX_WORKER_SECRET` (same as worker queries).

## Mid-session behavior (no reconnect)

| User action (web) | Effect |
|-------------------|--------|
| Ban / invalidation | Kick ~3s on current server + SSE `hud_error` |
| Steam link / register | Clears `not_registered`; can keep playing |
| `saveTime=false` | Next lap skips Convex ingest; HUD local OK |
| `acceptBattle=false` | No **new** battles; active battle continues until FINISHED |
| `acceptBattle` toggle | Private in-game chat to that player only (enabled/disabled message) |

See also [`telemetry-data/REDIS_CONTRACT.md`](../telemetry-data/REDIS_CONTRACT.md) pub/sub `ac:user:prefs:notify`.

See also [`CONVEX_PLAYER_JOIN_CONTEXT.md`](CONVEX_PLAYER_JOIN_CONTEXT.md), [`CONVEX_USER_PREFS.md`](CONVEX_USER_PREFS.md).

Verify: `./scripts/verify-hud-worker-refresh.sh STEAM_ID`
