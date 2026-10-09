# Install Control API into ProjectD (Next.js BFF)

This monorepo is the **hub/edge**. ProjectD Host lives in a separate repo.

**MVP (start here):** [PROJECTD_WEB_CONVEX_HUB_HANDOFF.md](./PROJECTD_WEB_CONVEX_HUB_HANDOFF.md) — Convex catalog + Redis start; hub BFF ≈ **live** only; `CONTROL_API_HOST_OPS` off.  
**Hub → Convex catalog sync:** [HOST_CATALOG_SYNC.md](../HOST_CATALOG_SYNC.md).

**Full ops / phase-2 handoff (ensure + allocate):** [PROJECTD_HOST_TEAM_HANDOFF.md](./PROJECTD_HOST_TEAM_HANDOFF.md) — ensure / allocate only; not the MVP start path.

**Preferred BFF:** Next.js Route Handlers (`/api/control/*`) + Clerk — **not** Convex Actions for polling live (hub reads are not reactive).

## Env (Vercel / `.env.local` on ProjectD — server only)

```bash
CONTROL_API_URL=https://your-hub.example.com
CONVEX_WORKER_SECRET=…    # same as hub X-Worker-Secret; NEVER NEXT_PUBLIC_
# CONTROL_API_HOST_OPS=true   # phase 2 — allocate + treat hub /v1/mods as Host library
```

## MVP vs phase 2

| | MVP (default) | Phase 2 (`CONTROL_API_HOST_OPS=true`) |
|--|---------------|--------------------------------------|
| Catalog | Convex `battle_*` / `servers` | Optional hub `GET /v1/mods` UI |
| Start | Convex → Redis desired-config | region+preset → **allocate** → ensure → apply → start |
| Live | Hub `/v1/.../live` + summary | Same |
| Ensure ZIP | Ops when VPS missing content | Same + Host-driven ensure before start |

## What to implement in ProjectD (MVP)

1. `src/lib/controlApi/server.ts` — `requireUser` (Clerk) + `controlGet`/`controlPost` with `X-Worker-Secret`
2. Route Handlers under `app/api/control/` for **live** at minimum:
   - `GET /live/summary`
   - `GET /servers/:lobby/live?instanceId=`
3. Client: Convex for catalog/start; `fetch('/api/control/…')` for live ~5s
4. Live path uses **lobby name**, not Convex `servers._id`
5. After Host no longer needs `live_players`: ops sets `LIVE_INGEST_CONVEX=false` on every edge

## Phase 2 extras (only if flag on)

- Central library: `GET /v1/mods`, availability, ensure, inventory skins/layouts when LOCAL
- Flow: catalog → ensure LOCAL → allocate → apply-config → start
- Do **not** build the global library from per-VPS inventory alone

Hub contracts: [CONTROL_API_V1.md](../CONTROL_API_V1.md), [MOD_DISTRIBUTION.md](../MOD_DISTRIBUTION.md), [SERVER_PLATFORM.md](../SERVER_PLATFORM.md), [HUD_HARDENING_CUTOVER.md](../HUD_HARDENING_CUTOVER.md), [openapi/control-api-v1.yaml](../openapi/control-api-v1.yaml).

## Smoke (hub reachable)

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

# MVP — live
curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"

# Phase 2 — only if using allocate / hub catalog
# curl -sS "$HUB/v1/mods" -H "X-Worker-Secret: $SECRET" | head -c 400
# curl -sS "$HUB/v1/servers?region=eu&status=idle" -H "X-Worker-Secret: $SECRET"
```
