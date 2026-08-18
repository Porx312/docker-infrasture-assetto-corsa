# Convex: lap PB / rival HUD push (ProjectD)

Session updates (rank, rivals, best lap, ELO) after a lap are **owned by Convex**, not ac-data `lap_completed` refresh. Convex schedules `notifyAcDataHudRefresh` → ac-data `POST /hud/worker/refresh-user` → WSS `hud_session`.

Overlay poll (`GET /hud/snapshot`) uses **interleaved sections** in poll-only mode (WSS inactive or `hud_transport=poll`):

| Situation | `sections` |
|-----------|------------|
| Startup / context mismatch | `full` |
| Live battle (prep/active) or WSS battle backup | `battle` |
| Post-battle terminal (finished/cancelled) | `session` (ELO) |
| Idle competition, poll-only | **alternate** `battle` ↔ `session` each tick |

This keeps Redis matchmaking (`battle`) and Convex session updates (`session`) without breaking either. WSS push is optional when the client connects (`wsListeners>0`).

**PB contract:** ac-data `patchLastLapInCaches` updates **only** `last_lap_ms` in Redis. `best_lap_ms` comes from Convex via `refresh-user` (`lap_pb` / `rival_pb`). Never write PB from local lap events — small test values (e.g. `500` ms) get mis-displayed as 8:20.000 when Lua `normalize_lap_ms` treats values `<1000` as seconds.

See also [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md), [`HUD_TIME_ATTACK_INTEGRATION.md`](HUD_TIME_ATTACK_INTEGRATION.md).

## Flow

```mermaid
sequenceDiagram
    participant Tel as telemetry
    participant AC as ac_data
    participant Convex as Convex_ProjectD
    participant HUD as ProjectD_HUD

    Tel->>AC: lap_completed Redis
    AC->>Convex: batch ingest lap
    Note over AC: patch last_lap_ms only; no session refresh
    Convex->>Convex: persist lap + recompute rank/rivals
    Convex->>AC: POST refresh-user reason=lap_pb|rival_pb
    AC->>Convex: getPlayerJoinContext
    AC-->>HUD: WSS hud_session
    HUD->>AC: poll sections=battle|session alternate
    AC-->>HUD: battle or session snapshot
```

## ac-data (this repo)

| Setting | Default | Meaning |
|---------|---------|---------|
| `HUD_LAP_AC_DATA_REFRESH_ENABLED` | `false` | When false, `lap_completed` does not run debounced refresh / rival fan-out in ac-data |

`handleLapCompletedAfterIngest` still:
- patches **only** `last_lap_ms` in Redis (immediate local display; does **not** update `best_lap_ms`)
- invalidates session cache on PB (so `refresh-user` fetches fresh data)

Worker reasons handled in [`hudUserStatusNotify.ts`](../ac-data/src/services/hud/hudUserStatusNotify.ts):

| `reason` | WSS `pushReason` | Live fetch |
|----------|------------------|------------|
| `lap_pb` | `lap_pb` | yes |
| `rival_pb` | `rival_pb` | yes |
| `session` | `join_initial` | yes |
| `cosmetics` | `worker_cosmetics` | yes |

## ProjectD Convex implementation

Implement in the **lap ingest mutation** (after leaderboard write). Convex lives in ProjectD, not this repo.

### 1. Bump `session.version`

Required for every affected steamId when rank, rivals, best lap, or ELO change. Without bump, ac-data may serve stale Redis until TTL.

### 2. Collect notify targets (dedupe)

After recomputing board state for the lap author:

- **Author** — if PB or rank/rivals/ELO changed → `reason: "lap_pb"`
- **Previous rivals** (`above` / `below` before update) — if author's PB may change their window → `reason: "rival_pb"`
- **New rivals** after update — same
- Optional: players within ±N ranks on the same board if full-window recompute is expensive

Skip all notifications when `saveTime === false` (no lap persisted).

### 3. Schedule ac-data refresh

Reuse existing internal action from [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md):

```typescript
await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataHudRefresh, {
  steamId: targetSteamId,
  reason: targetSteamId === authorSteamId ? "lap_pb" : "rival_pb",
});
```

Use `runAfter(0, …)` after mutation commit. If rival recompute is async, `runAfter(100, …)` is acceptable.

### 4. Example helper (ProjectD)

```typescript
async function notifyHudSessionTargets(
  ctx: MutationCtx,
  authorSteamId: string,
  before: { above?: Rival | null; below?: Rival | null },
  after: { above?: Rival | null; below?: Rival | null },
  changed: { rank?: boolean; pb?: boolean; elo?: boolean },
) {
  if (!changed.rank && !changed.pb && !changed.elo) return;

  const targets = new Set<string>();
  if (authorSteamId) targets.add(authorSteamId);

  for (const rival of [before.above, before.below, after.above, after.below]) {
    const sid = rival?.steamId ?? rival?.steam_id;
    if (sid) targets.add(sid);
  }

  for (const steamId of targets) {
    await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataHudRefresh, {
      steamId,
      reason: steamId === authorSteamId ? "lap_pb" : "rival_pb",
    });
  }
}
```

### Convex dashboard env

- `AC_DATA_BASE_URL` — public ac-data URL (not `127.0.0.1` from Convex cloud)
- `CONVEX_WORKER_SECRET` — same as VPS `.env.local`

## Verification

**Before Convex deploy** (manual push):

```bash
./scripts/verify-push-sync-live.sh STEAM_ID lap_pb
./scripts/simulate-lap-completed.sh STEAM_ID --lap-ms 20000
# overlay must have WSS connected; poll alone will not show session updates
```

**After Convex deploy:**

```bash
tail -f ac-data.log | rg 'refresh-user|hud-user-status.*lap_pb|hud-user-status.*rival_pb'
./scripts/verify-hud-rival-fanout.sh OBSERVER_STEAM_ID RIVAL_STEAM_ID LAP_MS
```

**Battle + session poll** (interleaved idle poll):

```bash
ProjectD-HUD/scripts/verify-session-context-switch.sh
tail -f ac-data.log | rg 'hud-snapshot.*sections=(battle|session)'
```

**Repair corrupted best_lap_ms** (after bad test laps):

```bash
./scripts/verify-push-sync-live.sh STEAM_ID lap_pb
curl -s 'http://127.0.0.1:3000/hud/snapshot?steamId=STEAM_ID&sections=session&carFilter=global' | jq '.session.profile.best_lap_ms'
# Expect >= 1000 (milliseconds). Use realistic --lap-ms (>= 60000) in simulate-lap-completed.sh
```

## Rollback

Set on VPS:

```bash
HUD_LAP_AC_DATA_REFRESH_ENABLED=true
```

Restores ac-data debounced lap refresh + rival fan-out (legacy path). Still requires WSS for push delivery.

## Deploy order

1. ac-data (this repo) — disabled lap refresh + reason mapping
2. ProjectD Convex — lap mutation schedulers
3. ProjectD-HUD — interleaved battle/session poll + PB patch fix
