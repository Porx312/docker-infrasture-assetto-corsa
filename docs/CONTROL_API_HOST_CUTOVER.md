# ProjectD Host cutover — Control API

Wire the Host UI to the hub Control API so you stop manual Convex mod catalogs and stop using `live_players` for dashboards.

This repo is **assetto-infra** (hub/edge). ProjectD Host uses a **Next.js BFF** (`/api/control/*`); do not proxy the hub through Convex Actions.

**Full team guide:** [examples/PROJECTD_HOST_TEAM_HANDOFF.md](./examples/PROJECTD_HOST_TEAM_HANDOFF.md) (servers + central mods + ensure).  
Also: [CONTROL_API_V1.md](./CONTROL_API_V1.md), [control-api-vps-spec.md](./control-api-vps-spec.md), [examples/PROJECTD_BFF_INSTALL.md](./examples/PROJECTD_BFF_INSTALL.md), [SERVER_PLATFORM.md](./SERVER_PLATFORM.md), [MOD_DISTRIBUTION.md](./MOD_DISTRIBUTION.md), [VPS_FLEET_SETUP.md](./VPS_FLEET_SETUP.md).

---

## Prerequisites (fleet) — verify

Confirm before Host cutover:

1. **Shared Redis** hub↔edges (same `REDIS_URL` / host). If Redis differs, live GET is empty.
2. Hub public HTTPS URL = ProjectD server env `CONTROL_API_URL`.
3. Hub has `DATABASE_URL` (central mod library + server slots) and mods uploaded in admin.
4. Edge `MOD_AGENT_ENABLED=true` (distribution) + optional `MOD_INVENTORY_SCAN_ENABLED=true` (legacy inventory).
5. `GET /v1/mods` returns packages; `GET /v1/mods/availability?instanceId=` returns items.
6. `GET /v1/live/summary` shows players when someone is in AC (`X-Worker-Secret`).
7. Host maps **lobby name** (not Convex `_id`) for live.

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

curl -sS "$HUB/v1/mods" -H "X-Worker-Secret: $SECRET" | head -c 300
curl -sS "$HUB/v1/mods/availability?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET" | head -c 300
curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"
```

Legacy inventory (cutover only): `GET /v1/instances/$INSTANCE/mods/cars` — **not** the Host library SoT.

---

## ProjectD env (Vercel / `.env.local` — server only)

```bash
CONTROL_API_URL=https://your-hub.example.com
CONVEX_WORKER_SECRET=…    # same as hub X-Worker-Secret
```

Do **not** put the worker secret in `NEXT_PUBLIC_*` or the browser.

Optional alias: `AC_DATA_BASE_URL` (= hub URL).

---

## BFF (Next.js — preferred)

1. Follow [examples/PROJECTD_HOST_TEAM_HANDOFF.md](./examples/PROJECTD_HOST_TEAM_HANDOFF.md) (or the short [PROJECTD_BFF_INSTALL.md](./examples/PROJECTD_BFF_INSTALL.md)) in the **ProjectD** repo.
2. Route Handlers under `/api/control/*` with Clerk `requireUser` → hub `/v1/*` + `X-Worker-Secret`.
3. Host UI: `fetch('/api/control/…')` — **never** call the hub from the browser; **avoid** Convex Actions as hub proxy.

| Host need | Hub path (via `/api/control`) |
|-----------|-------------------------------|
| **Mod library (preferred)** | `GET /v1/mods`, `GET /v1/mods/:slug` |
| **VPS badges** | `GET /v1/mods/availability?instanceId=` |
| **Prefetch** | `POST /v1/instances/:id/mods/ensure` |
| Legacy inventory (cutover) | `GET /v1/instances/:id/mods/cars\|tracks` |
| Lobby roster | `GET /v1/servers/:lobby/live` |
| Browse / nav counts | `GET /v1/live/summary` |
| Free slots | `GET /v1/servers?region=&status=idle` |
| Allocate + lifecycle | `POST /v1/servers/allocate`, `…/apply-config`, `…/start\|stop` |

---

## Host UI changes

1. **Mods:** central catalog `GET /v1/mods` + `availability` badges (`LOCAL` / `MISSING` / `DOWNLOADING` / …). Optional `imageUrl`. Do **not** build the library from per-VPS inventory.
2. **Ensure** required mods before apply/start; poll until `LOCAL` (or surface `ERROR`).
3. Live: summary + roster via Next BFF (not `live_players`).
4. `instanceId` = edge `AC_INSTANCE_ID`.
5. Live `serverId` / path segment = **lobby name**; map from Convex `_id` if needed.
6. Session flow: **region + preset → allocate → ensure → apply-config → start** ([SERVER_PLATFORM.md](./SERVER_PLATFORM.md), [HOST_TEAM_HANDOFF](./examples/PROJECTD_HOST_TEAM_HANDOFF.md)).

---

## Edge flag after cutover (`LIVE_INGEST_CONVEX`)

**Only after** Host dashboards read live from Control API (no `live_players` dependency):

```bash
# on every edge
LIVE_INGEST_CONVEX=false
```

| Still goes to Convex | Stays Redis / hub only |
|----------------------|-------------------------|
| Laps | Join / leave |
| Battles | `server_status` presence |

Leave `LIVE_INGEST_CONVEX=true` until Host is switched — otherwise Convex dashboards go empty mid-migration.

---

## Verify (post-cutover)

1. Host picker shows **central** cars/tracks + per-VPS availability (not inventory-as-library).
2. DevTools: only `/api/control/*` from the browser (no direct hub fetch).
3. Ensure → LOCAL → start works; missing/ERROR blocks start.
4. HUD WSS / laps / battles still work.
5. Allocate + apply-config + start without treating Redis inventory as the only gate.
6. After UI OK: `LIVE_INGEST_CONVEX=false` on all edges.
