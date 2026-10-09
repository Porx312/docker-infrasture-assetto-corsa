# HUD hardening cutover checklist

Infra changes in this repo (shared cache keys, presence type, gateway tests) do **not** replace the ProjectD Convex contract. Use this before setting `LIVE_INGEST_CONVEX=false` on edges.

## Prerequisites

1. Deploy ProjectD Convex with optional Redis `presence` on `getPlayerJoinContext` / `getHudSession` (archived handoff: [archive/examples/PROJECTD_HUD_PRESENCE_NO_LIVE_PLAYERS.md](./archive/examples/PROJECTD_HUD_PRESENCE_NO_LIVE_PLAYERS.md)).
2. Hub + all edges share the same Redis and `FLEET_EDGE_SECRET` or `CONVEX_WORKER_SECRET` (optional `MOD_PEER_SECRET` for blob peer pull).
3. Each edge has `EDGE_PUBLIC_BASE_URL`, `EDGE_REGISTRY_BASE_URL`, `HUD_WS_ENABLED=true`.
4. Hub has `FLEET_EDGE_REGISTRY` (bootstrap) + `HUD_PUBLIC_BASE_URL`; Postgres `fleet_edges` overlays at runtime.
5. Edge default is `LIVE_INGEST_CONVEX=false` — only set `true` as temporary Convex deploy fallback.

## Verify on one edge

1. Player joins AC lobby → Redis key `ac:hud:presence:{steamId}` present.
2. Overlay bootstrap against hub → `ws.primary` is that edge’s public URL.
3. Edge logs: session OK; **no** repeating `[hud-convex] convex_session_ignores_presence`.
4. Stats (if `HUD_CONVEX_QUERY_LOG_INTERVAL_MS` set): counter `convex_session_ignores_presence` stays 0.
5. Only then set `LIVE_INGEST_CONVEX=false` on that edge and retest HUD session + Host live roster.

## Overlay anti-flicker

- Prefer WSS connected (not HTTP-only poll).
- Ship overlay from repo [`ProjectD-HUD/`](../ProjectD-HUD/) (includes `session_version_dedupe.lua`).
- Hub download ZIP under `packages/ac-data-backend/projectd-hud/releases/` must be built from that same tree (admin HUD upload). See [HUD_SNAPSHOT_POLL_FLICKER.md](./HUD_SNAPSHOT_POLL_FLICKER.md).

## Version semantics

| Field | Meaning |
|-------|---------|
| Redis `ac:hud:ver:*` / pubsub bump | Invalidation token (`Date.now()`), not for UI dedupe |
| Snapshot/WSS `playerVersion` | Content hash (`buildHudVersionForSession`) — overlay dedupe uses this |
