# WSS Migration Report

Post-migration validation and legacy cleanup for HUD transport (SSE/TCP → WebSocket).

**Date:** 2026-08-18  
**Branch baseline:** WSS already implemented; this pass validates, cleans orphans, aligns tests/docs/config.

## 1. WebSocket state

| Check | Result |
|-------|--------|
| Route `GET /hud/ws` | Active (`hudWs.ts`) |
| Route `GET /hud/stream` | **Removed** (0 route handlers) |
| Live connect log | `[hud-ws-connect]` in `ac-data.log` for `76561199230780195` |
| Contract script | `./scripts/verify-hud-ws-contract.sh` (uses `ac-data/node_modules/ws`) |
| Overlay transport | `battle_ws.lua` + `battle_transport.lua` |

**Frames:** JSON `{ event, data }` — `hud_version`, `hud_session`, `battle`, `hud_error`.

## 2. Convex query volume (idle)

Measured via `GET /hud/worker/convex-query-stats` (worker secret).

### Pre-cleanup (WSS connected, ~65s sample)

| Metric | T0 | T+65s | Delta |
|--------|-----|-------|-------|
| `fetchHudVersion` | 12 | 12 | **0** |
| `fetchHudSession` | 162 | 163 | **+1** (event-driven, not ~5s poll) |
| `streamConnected` | 1 | 1 | stable |

### Post-cleanup (no WSS client during sample)

| Metric | T0 | T+65s | Delta |
|--------|-----|-------|-------|
| `fetchHudVersion` | 164 | 164 | **0** |
| `fetchHudSession` | 164 | 164 | **0** |
| `streamConnected` | 0 | 0 | — |

**Gate script:** `./scripts/verify-hud-idle-query-volume.sh [minutes] [max_delta_per_min]`  
**Success criterion:** With WSS connected and player idle 10 min, no periodic increment of `fetchHudVersion` / `fetchHudSession` (~every 5s legacy poll rejected).

Client gate: `session_snapshot.lua` `should_poll` → `wss_active_no_session_poll` when WSS up and no battle/terminal need.

## 3. Fallback and anti-coexistence

| Mode | Session poll (`sections=session`) | Battle poll (`sections=battle`) |
|------|-----------------------------------|----------------------------------|
| WSS up, idle | OFF | OFF (except backup/stale rules) |
| WSS down | ON (alternating session/battle) | ON |
| WSS reconnect | OFF after initial WSS snapshot | per battle rules |

**Fix applied:** `battle_ws.disconnect()` / `onClose` / `onError` clear `state.hud_transport` when it was `"wss"`.  
**Fix applied:** `battle_fetch.battle_transport_active()` no longer treats stale `hud_transport=="wss"` without live socket.

**Manual fallback sequence** (operator): stop ac-data briefly → overlay falls back to `poll` + `/hud/snapshot`; restore → WSS reconnect. Re-run `./scripts/verify-hud-idle-query-volume.sh 10`.

## 4. Legacy removed

| Item | Location |
|------|----------|
| SSE stream helpers | `ProjectD-HUD/common/api/web_queue.lua` — `open_stream`, `poll_stream`, `close_stream`, `start_stream_item`, `text/event-stream` |
| `battle_sse_connected_at` fallbacks | `session_snapshot.lua`, `battle_fetch.lua`, `status.lua` |
| `state.web_stream` | `state/web.lua`, `api_data.lua`, `images.lua` |
| `hudSsePush.ts` shim | Deleted; imports → `hudPushHub.ts` |
| `hudSsePush.test.ts` | Deleted (covered by `hudPushHub.test.ts`) |

## 5. Legacy retained (justified)

| Class | Examples | Why |
|-------|----------|-----|
| **A — active WSS** | `hudWs.ts`, `hudPushHub.ts`, `battle_ws.lua` | Primary transport |
| **A — battle room** | `hudStreamSseBattleRoom.ts` | Redis pub/sub fanout (name legacy; optional rename later) |
| **G — metrics alias** | `streamConnected` + new `wsConnected` | Backward compat for dashboards |
| **H — Redis keys** | `ac:hud:sse:*` | telemetry matchmaking + presence (`hud_sse_presence.py`) |
| **Env names** | `HUD_SSE_PRESENCE_TTL_SEC`, `BATTLE_REQUIRE_HUD_SSE` | External consumers; document as “overlay presence”, not SSE wire |
| **Battle backup poll** | `sections=battle` while WSS connected | Matchmaking detection, stale recovery |

## 6. Redis `ac:hud:sse:*`

**Decision:** Keep key prefix (no rename in this pass).

| Writer | When |
|--------|------|
| `hudSsePresence.ts` | WSS connect (`markHudSseConnected`) |

| Reader | Purpose |
|--------|---------|
| `telemetry-data/core/hud_sse_presence.py` | Matchmaking gate (`BATTLE_REQUIRE_HUD_SSE`) |

TTL: `HUD_SSE_PRESENCE_TTL_SEC` (default 45s). Future coordinated rename → `ac:hud:ws:*` with telemetry-data.

## 7. Tests and scripts

| Test / script | Status |
|---------------|--------|
| `hudWs.test.ts`, `hudPushHub.test.ts` | Pass (CI `hud-contract.yml`) |
| `hudConvexQueryStats.test.ts` | Pass |
| `hudUserStatusNotify.test.ts` | Migrated to `hudPushHub` imports |
| `verify-session-context-switch.sh` | Pass — WSS gates + no `battle_sse_connected_at` |
| `verify-hud-ws-contract.sh` | Canonical WSS contract |
| `verify-battle-hud.sh` | Delegates to ws-contract |
| `verify-hud-idle-query-volume.sh` | **New** — idle Convex drift gate |
| `simulate-lap-completed.sh` | `--watch-ws` (alias `--watch-sse`) |
| `simulate-battle-complete.sh` | `--watch-ws` background |
| `hud-load-test/hudClient.ts` | `connectWs()` via native WebSocket |

## 8. Config

Restored **`.env.example`** (WSS-first):

- `HUD_WS_ENABLED=true`
- `HUD_SSE_ENABLED=false` (route removed)
- Documents `BATTLE_REQUIRE_HUD_SSE` and `HUD_SSE_PRESENCE_TTL_SEC` as presence/matchmaking, not SSE transport.

## 9. Post-cleanup grep (code)

Active hits for `/hud/stream`, `hudSsePush`, `open_stream` in **application code:** **0**  
Remaining hits: docs, changelog-style comments, `verify-hud-sse-gate.sh` (presence gate name), overlay-contract comment.

## 10. Risks / follow-ups

1. **10 min idle gate** — run `./scripts/verify-hud-idle-query-volume.sh 10` with player in-game and WSS connected before prod sign-off.
2. **Push events** — validate live: `./scripts/simulate-lap-completed.sh STEAM_ID --lap-ms … --watch-ws`, `./scripts/verify-push-sync-live.sh STEAM_ID cosmetics`.
3. **Rename** `hudStreamSseBattleRoom.ts` → `hudBattleRoom.ts` (optional, non-blocking).
4. **Redis** `ac:hud:sse:*` → `ac:hud:ws:*` requires telemetry-data + ac-data coordinated deploy.
5. **Docs** — `HUD_BATTLE_INTEGRATION.md` body still contains historical SSE wording in deep sections; header updated WSS-first.

## Architecture (final)

```text
Convex → event → ac-data hudPushHub → WSS GET /hud/ws → ProjectD-HUD
Fallback: WSS down → GET /hud/snapshot (poll)
```
