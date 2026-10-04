# Handoff ProjectD: sesión HUD sin `live_players`

**Where to implement:** ProjectD repo (Convex), **not** assetto-infra.  
**Paste this file (or the Cursor prompt in §7) into a ProjectD chat.**

Edge (assetto-infra) sends Redis `presence` on join/session/version queries. After this Convex contract is live in production, ops can set `LIVE_INGEST_CONVEX=false`.

Cross-links (assetto-infra): [CONVEX_PLAYER_JOIN_CONTEXT.md](../CONVEX_PLAYER_JOIN_CONTEXT.md), [CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md), [CONVEX_PROFILE_COSMETICS.md](../CONVEX_PROFILE_COSMETICS.md).

---

## 1. One sentence

> Host already reads connected players from the hub live API. HUD session must stop requiring Convex `live_players`: accept optional `presence` from ac-data (Redis) in `getPlayerJoinContext` / `getHudSession`, keep `live_players` only as deploy fallback, then infra can set `LIVE_INGEST_CONVEX=false`.

---

## 2. As-is (do not break)

- Convex does **not** push to HUD Lua. ac-data emits SSE after worker queries.
- Ingest (`ingestWorkerEventsBatch` → `playerJoinCore` / `updateServerStatusCore`) writes `live_players`.
- Session today: `resolveHudLiveSession` → `buildHudSessionForSteamId` → `getPlayerJoinContext` / `getHudSession` (reads `live_players`).
- Mid-session prefs/ban/cosmetics/PB: `notifyAcDataHudRefresh` → `POST …/hud/worker/refresh-user` — **leave as-is**.
- Host UI roster: hub Control API — **leave as-is** (do not reintroduce `live_players` queries for Host dashboards).

Problem: turning off live ingest empties `live_players` → HUD `player_not_connected` even when Redis presence exists.

---

## 3. Contract (implement in Convex)

Extend args on:

- `workerPlayers:getPlayerJoinContext`
- `hud:getHudSession` (and any wrapper into `buildHudSessionForSteamId` / `resolveHudLiveSession`)

```typescript
{
  workerSecret: string;
  steamId: string;
  presence?: {
    serverName: string;   // lobby display name (e.g. "Battles P")
    instanceId?: string;  // AC_INSTANCE_ID
    folderSlug?: string;  // e.g. "server-4"
    carModel?: string;
    track?: string;
    trackConfig?: string;
  };
}
```

### `resolveHudLiveSession` priority

1. User missing → `user_not_found` (current shape).
2. `users.isInvalidated` → `user_invalidated` **before** connected checks.
3. If `presence?.serverName` (non-empty trim):
   - Treat as connected.
   - Build `session.context` from `presence` (same fields as today from a live row: `server_name`, `car_id`, `track_id`, layout/trackConfig, etc.).
   - Profile / LB / rivals / prefs / cosmetics via `buildHudSessionForSteamId` **without** requiring a `live_players` row.
   - `session.ok === true`.
4. Else if a usable `live_players` row exists → **current** behavior (deploy fallback).
5. Else → `session: { ok: false, reason: "player_not_connected" }`.

Do **not** schedule `notifyAcDataHudRefresh` from `playerJoinCore` / `updateServerStatusCore` for this work (avoids `server_status` flood).

Response shape stays `{ user, session }` only — no separate `player` field.

---

## 4. Files to touch (ProjectD)

| File | Change |
|------|--------|
| `convex/lib/hudLiveSession.ts` | Resolve context from `presence` first |
| `convex/lib/hudSessionBundle.ts` | Accept presence; no live-row gate when presence set |
| `convex/lib/hudPlayerJoinContext.ts` | Pass presence into bundle |
| `convex/workerPlayers.ts` | Optional `presence` validator on `getPlayerJoinContext` |
| `convex/hud.ts` | Same on `getHudSession` |
| `docs/CONVEX_PLAYER_JOIN_CONTEXT.md` | Document presence + resolution order |
| `docs/ac-data-hud-spec.md` / `docs/08-hud-api.md` | Note: join seed still ac-data; connected anchor = presence args |

Ingest (`convex/live/players.ts`, `convex/ingest/workerRouter.ts`): **no required functional change**. When edge sets `LIVE_INGEST_CONVEX=false`, those mutations simply stop receiving join/status.

---

## 5. What not to change

- Host BFF live (`CONTROL_API_URL` / `/api/control/.../live`).
- Login / Clerk → does not write HUD or `live_players`.
- `notifyAcDataHudRefresh` for prefs / ban / cosmetics / PB / ELO.
- Deleting the `live_players` table (legacy OK).

---

## 6. Acceptance (Convex)

| Case | Expected |
|------|----------|
| Valid `presence` + user OK, **no** `live_players` row | `session.ok === true` |
| No `presence`, no live row | `player_not_connected` |
| No `presence`, live row exists | OK (fallback) |
| Banned user | `user_invalidated` (unchanged) |
| Unknown steamId | `user_not_found` |
| refresh-user while in server | ac-data will send `presence` after edge ships; offline → `player_not_connected` OK |

Add convex-test / unit coverage: presence-only, live_players-only, neither, banned.

---

## 7. Cursor prompt (paste in ProjectD)

```text
Implement HUD session without requiring live_players.
Extend getPlayerJoinContext and getHudSession with optional presence
{ serverName, instanceId?, folderSlug?, carModel?, track?, trackConfig? }.
In resolveHudLiveSession / buildHudSessionForSteamId: if presence.serverName
is set, build session.context from it and return session.ok without reading
live_players; keep live_players as fallback when presence is absent.
Do not add notifyAcDataHudRefresh from playerJoinCore/updateServerStatusCore.
Keep refresh-user path for prefs/ban/cosmetics. Update ProjectD HUD docs.
Add tests: presence-only, live_players fallback, neither, banned.
```

---

## 8. Deploy order (coord with infra)

1. **ProjectD:** deploy Convex (`presence` + `live_players` fallback). Ping infra when live.
2. **assetto-infra:** edge/shared send Redis `ac:hud:presence:*` as `presence` on join/session queries.
3. Verify HUD with ingest still **on**.
4. **Ops:** `LIVE_INGEST_CONVEX=false` on all edges; re-verify `/hud/snapshot` 200 + Host live BFF.

Until step 1 ships, infra **must not** cut live ingest.

### Ping template to infra

```text
Convex HUD presence contract deployed:
- getPlayerJoinContext / getHudSession accept optional presence
- session.ok without live_players when presence.serverName set
- live_players fallback still works
Please ship edge presence args + then LIVE_INGEST_CONVEX=false.
```

---

## 9. Infra follow-up (not this PR)

Plan in assetto-infra: shared `queryPlayerJoinContext` / hub worker forward + edge read presence + docs + ops flag. See also [CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md) § Edge flag after cutover.
