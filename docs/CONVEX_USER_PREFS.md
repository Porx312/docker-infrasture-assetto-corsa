# Convex: user profile prefs (`saveTime`, `acceptBattle`)

Worker enforcement lives in **assetto-infra** (ac-data + telemetry-data). Convex (ProjectD) owns the source of truth and authoritative lap ingest gate.

## Schema (`users` table)

```typescript
saveTime: v.optional(v.boolean()),      // default true when missing
acceptBattle: v.optional(v.boolean()),  // default true when missing
```

Existing users without these fields behave as **opt-out defaults** (`true`).

## HUD session profile

In `convex/lib/hudSessionBundle.ts` → `buildHudSessionForSteamId`, include on `profile`:

```json
{
  "saveTime": true,
  "acceptBattle": true
}
```

Use camelCase in Convex; ac-data accepts `save_time` / `accept_battle` snake_case too.

`getPlayerJoinContext` / join context must expose the same fields on `session.profile` when session is ok.

Changes apply **immediately** when Convex schedules `POST /hud/worker/refresh-user` after the mutation (see [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md)). `player_join` is fallback only.

## Web UI

Settings page toggles bound to a mutation, e.g. `users:updatePrivacyPrefs`:

```typescript
args: {
  saveTime: v.optional(v.boolean()),
  acceptBattle: v.optional(v.boolean()),
}
```

After patch, schedule `notifyAcDataHudRefresh` with `reason: "prefs"` (see [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md)). If the player is connected, telemetry-data sends a **private server chat** when `acceptBattle` changes (not on `player_join`).

## Ingest gate (authoritative)

In `serverEvents:ingestWorkerEventsBatch` handler for `lap_completed`:

1. Load user by `data.steamId`
2. If `user.saveTime === false`, **skip** verified lap / leaderboard write
3. Return `{ ok: true, index }` for that event so ac-data acks the Redis message

ac-data also skips forwarding when Redis pref `ac:user:prefs:save_time:{steamId}` is `"0"` (belt-and-suspenders).

## Behavior summary

| Pref | Default | `false` effect |
|------|---------|----------------|
| `saveTime` | `true` | No Convex lap persistence; HUD still shows local lap times |
| `acceptBattle` | `true` | telemetry-data excludes player from battle matchmaking |

Verify worker bridge: `./scripts/verify-user-prefs.sh [steamId]`
