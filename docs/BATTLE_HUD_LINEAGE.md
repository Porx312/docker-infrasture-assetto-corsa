# Battle HUD Data Lineage Report

Battle under investigation: `battle-476c184f179a` (Gunsai Testing, PORX vs projectd).

## VPS evidence (confirmed)

| Stage | battleId | state | revision | score | result |
|-------|----------|-------|----------|-------|--------|
| Redis presence | — | — | — | — | PASS (`Gunsai Testing`, EXISTS=1) |
| curl debug URL (A) | battle-476c184f179a | active | ? | 0-0 → 1-0 | PASS |
| curl HUD URL (B) | identical when same presence | active | ? | same | PASS (shapes equivalent) |

URL shape comparison (`./scripts/compare-hud-snapshot-request.sh`): battle payload **IDENTICAL** between debug script URL and HUD client URL when presence matches.

## Client stages (requires CSP export during live battle)

Enable on gaming PC:

```lua
-- scripts/battle-hud-client-debug.lua
ac.storage("ProjectD-HUD:use_api", true):set()
ac.storage("ProjectD-HUD:battle_sync_trace", true):set()
```

| Stage | battleId | state | revision | score | result |
|-------|----------|-------|----------|-------|--------|
| [BATTLE_FETCH] HTTP | ? | ? | ? | ? | **USER CAPTURE** |
| [BATTLE_RAW] | ? | ? | ? | ? | **USER CAPTURE** |
| [BATTLE_REVISION] | ? | — | ACCEPT/REJECT | — | **USER CAPTURE** |
| [BATTLE_TRACE] APPLY_OUT | ? | ? | ? | ? | **USER CAPTURE** |
| [BATTLE_RENDER_GATE] | — | — | — | — | REAL vs LOOKING |
| [BATTLE_TRACE] RENDER | ? | ? | — | ? | **USER CAPTURE** |

Correlate: `./scripts/trace-battle-sync.sh path/to/csp-export.log`

## Diagnosis (code + VPS evidence)

**FIRST WORKING STAGE:** VPS `GET /hud/snapshot` (HTTP 200, battle active, score updates).

**FIRST BROKEN STAGE (symptom):** Renderer shows MATCHMAKING/LOOKING because `state.battle_ui == nil` → `api.get_battle()` falls back to `lobby_from_profile()`.

**Likely break point (pre-fix hypothesis):** `should_ignore_stale_snapshot()` rejected poll snapshots after `battle_ui` was cleared (SSE `no_battle`, reset, or latch) while revision guard still held `last_rev`, preventing recovery even when server returned valid active state.

## Minimal fix applied

In [`battle_fetch.lua`](../ProjectD-HUD/common/api/battle_fetch.lua) `should_ignore_stale_snapshot`:

- Reject stale revision/version only when `state.battle_ui ~= nil`.
- When `battle_ui` is nil, accept snapshot to recover (`reason=recover_nil_ui`).

**SECURITY IMPACT:** None. Auth, fail-closed, and stale protection for live UI unchanged.

## Regression test checklist

- [ ] Real battle: pairing → arming → armed → launching → active → score change → finished
- [ ] Second battle: new battleId, old revision cannot block new battle
- [ ] Profile + Competition still work
- [ ] Invalidated user still blocked
- [ ] Empty Steam ID still blocked
