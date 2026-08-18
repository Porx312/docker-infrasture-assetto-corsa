# JOIN → `getHudSession` fan-out investigation

Read-only analysis + runtime correlation (2026-08-18). See plan: JOIN getHudSession fan-out.

## Verdict

| Class | Result |
|-------|--------|
| **A** JOIN intentionally refreshes all observers in ac-data | **Rejected** — no loop over `listConnectedHudSteamIds()` on join |
| **B** JOIN accidentally runs `getHudSession` for all in ac-data | **Rejected** — join chain is O(1) on joining `steamId` |
| **C** Notify-all design but redundant per-user `getHudSession` | **Applies** when Convex sends N× `refresh-user` webhooks; ac-data was forcing extra `getHudSession` after `getPlayerJoinContext` already wrote Redis |

**Root cause of `1 join → ~N getHudSession`:** not the ac-data `player_join` handler. Most likely **Convex ProjectD** schedules `notifyAcDataHudRefresh` for many steamIds (same pattern as lap `rival_pb`), or dashboard counts internal `buildHudSessionForSteamId` inside `getPlayerJoinContext`.

## ac-data JOIN chain (O(1))

```
player_join (A)
  → redisConvexBridge onPlayerJoinMessagesRead + flushIngestChunk (×2 dispatch, deduped Convex fetch)
  → handlePlayerJoinBeforeIngest
  → noteHudPlayerJoin(A)          # Redis presence only
  → refreshHudAfterPlayerJoin(A)
  → refreshHudUserStatusFromConvex(A)  # no reason= → preferCachedSession path
  → refreshPlayerJoinFromConvex(A)     # getPlayerJoinContext once (dedupe 5s)
  → pushHudUpdateForSteamId(A)         # 0× getHudSession if cache has profile
```

Files: [`playerJoin.ts`](../ac-data/src/services/eventHandlers/playerJoin.ts), [`hudUserStatusNotify.ts`](../ac-data/src/services/hud/hudUserStatusNotify.ts), [`playerJoinContext.ts`](../ac-data/src/services/hud/playerJoinContext.ts), [`hudPushHub.ts`](../ac-data/src/services/hud/hudPushHub.ts).

## Only O(N) loop in ac-data HUD code

[`hudRivalFanout.ts`](../ac-data/src/services/hud/hudRivalFanout.ts) `refreshHudForRivalLapObservers` iterates `listConnectedHudSteamIds()`.

**Not wired to JOIN:** triggered only from `hudRefreshScheduler` lap/battle flush; `scheduleHudRefreshAfterLap` has no production callers; `HUD_LAP_AC_DATA_REFRESH_ENABLED` defaults false.

## Runtime correlation (this VPS)

Script: `./scripts/verify-join-hud-fanout.sh [steamId]`

| Signal | Observed |
|--------|----------|
| `[player-join]` lines | 4 total, single steamId per line — **no multi-player fan-out** |
| `[hud-rival-fanout]` | 0 |
| `[hud-user-status] live session refresh` | 0 (no Convex refresh-user burst in log) |
| `fetchPlayerJoinContext` (stats) | 4 |
| `fetchHudSession` (stats) | 111 |
| `wsConnected` (stats) | 0 at sample time |

**Interpretation:** `fetchHudSession` ≫ `fetchPlayerJoinContext` → most session fetches are **not** from join. Likely battle refresh scheduler, WSS keepalive `player_not_connected` retries, or historical load since process start.

Example join sequence (steamId `76561199230780195`):

1. `[player-join] … player=player_not_connected` — Convex ingest not yet visible to join context
2. `[hud-ws-connect]` — overlay connects WSS
3. Later `[player-join] … player=ok session=ok` — after ingest

No `[hud-rival-fanout]` or N× `[hud-user-status]` at same timestamp.

## Convex ProjectD audit (external repo)

ProjectD Convex code is **not** in assetto-infra. From docs:

| Event | Documented `notifyAcDataHudRefresh` targets |
|-------|---------------------------------------------|
| `player_join` ingest | **Not documented** — join refresh is ac-data fallback via Redis stream |
| Lap PB ingest | Author `lap_pb` + observers `rival_pb` ([`CONVEX_LAP_HUD_PUSH.md`](CONVEX_LAP_HUD_PUSH.md)) |
| Ban / prefs / cosmetics | Single steamId ([`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md)) |

**Action for ProjectD:** inspect lap/player ingest mutations. If `player_join` ingest recomputes leaderboard and schedules `rival_pb` for all connected/live players, that explains N≈connected. Fix: notify **only joining steamId** on join; reserve `rival_pb` fan-out for lap PB.

## ac-data fix (redundant `getHudSession` on refresh-user)

When Convex sends N× `POST /hud/worker/refresh-user`, ac-data already calls `getPlayerJoinContext` and writes `ac:hud:session:*`. Forcing `pushHudUpdateForSteamId(steamId, true)` added a **second** `getHudSession` per webhook.

**Change:** after `refreshPlayerJoinFromConvex`, use `preferCachedSession` for `lap_pb`, `rival_pb`, and `session` (version mismatch in `pushHudUpdateForSteamId` still fetches when stale). Keep `bypass=true` for `cosmetics` only (join context can lag dedicated session query).

## Answers to the 12 questions

1. **getHudSession(A) on join:** 0 happy path; 1–3 if cache miss; not ×N.
2. **getHudSession(B..Z) from join chain:** No.
3. **Extra calls initiator:** Convex N× webhooks or rival fanout (not join).
4. **Why observers processed:** Join does not; lap/Convex rival path does.
5. **Intentional all-observer refresh on join:** No in ac-data.
6. **Why individual fetch per observer:** Webhook path used bypass cache; fixed to prefer cache when version matches.
7. **O(N) unnecessary:** In webhook + old bypass path; not in join handler.
8. **Global cache invalidation on join:** No — only joining steamId.
9. **refreshPlayerJoinFromConvex global invalidation:** No.
10. **pushHudUpdateForSteamId steamId on join:** Correct (A only).
11. **repushSessionForPlayers on join:** No.
12. **JOIN + WSS reconnect multiply:** Only A's WSS init snapshot; not ×N others.

## Verify after rejoin

```bash
./scripts/verify-join-hud-fanout.sh YOUR_STEAM_ID
tail -f ac-data.log | rg '\[player-join\]|\[hud-user-status\]|\[hud-rival-fanout\]'
```

Compare Convex dashboard spike timestamp with ac-data lines above.
