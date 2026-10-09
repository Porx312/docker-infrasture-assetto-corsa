# Multi-region: ac-data-edge + ac-data-backend

Node is split into **two apps** plus shared libraries:

| Package | Deploy where | Role |
|---------|----------------|------|
| `@projectd/ac-data-edge` | Each game VPS | Spawn AC, telemetry bridge, HUD WSS, config applier |
| `@projectd/ac-data-backend` | Hub or your PC | Convex ingest, HUD gateway (single public API), admin |
| `@projectd/ac-data-shared` | (library) | Ingest auth, env, edge registry |

### HUD ownership

| Layer | Owns | Does not own |
|-------|------|----------------|
| **Edge** | Live HUD runtime: `/hud/ws`, snapshot, presence writes, Convex join, battle push, worker handlers that execute refresh | Player ZIP downloads; discovery for multi-VPS |
| **Hub** | Control plane: `GET /hud/bootstrap`, steamId→edge routing, registry sync, Convex webhook fan-out, optional HTTP/WS proxy, `/client/hud/*` downloads + admin releases | Session push / AC-local Redis HUD cache |
| **Shared** | Contracts: Redis keys/types, worker auth, registry sync client, query helpers, `projectdHudManager` | Express app wiring, process control |

## Backend-only VPS (sin clonar todo assetto-infra)

No necesitas telemetry, edge, ni carpetas `server/` en el hub. Solo **dos paquetes** + un `package.json` mínimo:

```
ac-data-backend-hub/
  package.json              # deploy/backend-hub/package.json
  packages/
    ac-data-shared/
    ac-data-backend/
```

En una máquina con el repo completo:

```bash
./scripts/package-backend-hub.sh
# → dist/ac-data-backend-hub.tar.gz
```

Sube el tarball al VPS hub, descomprime, crea `.env.production`, `npm install`, `npm run build`, `npm start`. Detalle: [deploy/backend-hub/README.md](../deploy/backend-hub/README.md).

**No** copies solo `packages/ac-data-backend` suelto: falta `ac-data-shared` y el `package.json` de workspaces → error 404 en npm.

## Install (repo completo en dev)

**Important:** install from the **repo root** (`assetto-infra/`), not from `packages/ac-data-backend` alone. `@projectd/ac-data-shared` is not on npm; npm workspaces link it locally.

If you only copied `packages/` to your PC, use the backend hub tarball above or include `package.json` (root) + `packages/ac-data-shared` + `packages/ac-data-backend`.

From repo root:

```bash
npm install
npm run build
```

Windows (PowerShell), backend on your PC:

```powershell
cd C:\path\to\assetto-infra
npm install
npm run build:backend
$env:ASSETTO_ENV_FILE="$PWD\.env.backend"
npm run dev:backend
```

## Run edge (VPS)

```bash
npm run dev:edge
# or production:
npm run build:edge && npm run start -w @projectd/ac-data-edge
```

Env: see [`packages/ac-data-edge/.env.example`](../packages/ac-data-edge/.env.example).

### Hub-centric (recommended multi-VPS)

Only the **hub** holds Convex SDK credentials (`CONVEX_DEPLOYMENT_URL`, `CONVEX_PRODUCT_KEY`, `CONVEX_INGEST_SECRET`, `CONVEX_WORKER_SECRET` for queries).

On each **edge** VPS:

```bash
BACKEND_INGEST_URL=https://your-hub.example.com
# BACKEND_WORKER_URL=…  # optional; defaults to BACKEND_INGEST_URL
REDIS_CONFIG_SYNC_ON_EDGE=false
CONVEX_WORKER_SECRET=…    # same as hub — X-Worker-Secret for hub↔edge only
# Do NOT set CONVEX_DEPLOYMENT_URL / CONVEX_PRODUCT_KEY / CONVEX_INGEST_SECRET on edge
```

Startup log: `hub-centric=true ingest=backend-forward worker=hub-forward config-sync=hub`.

| Traffic | Path |
|---------|------|
| Laps / joins / status → Convex | edge Redis bridge → `POST /worker/ingest-events` on hub |
| Join context / HUD session | edge → `POST /worker/player-join-context` (etc.) on hub → Convex |
| Config snapshot | Convex webhook → hub `POST /hud/worker/refresh-config` → hub fetches Convex → `POST /hud/worker/push-config-snapshot` on edge |
| HUD refresh user | Convex webhook → hub `POST /hud/worker/refresh-user` → edge (requires `instanceId` + `FLEET_EDGE_REGISTRY`) |

Set `FLEET_EDGE_REGISTRY` on the hub with `instanceId` matching each VPS `AC_INSTANCE_ID`:

```json
{"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2"}}
```

### Single-VPS dev (edge → Convex direct)

```bash
CONVEX_DIRECT_ON_EDGE=true
CONVEX_DEPLOYMENT_URL=…
CONVEX_PRODUCT_KEY=…
CONVEX_INGEST_SECRET=…
```

Without `BACKEND_INGEST_URL` and without `CONVEX_DIRECT_ON_EDGE`, edge still defaults to direct Convex when credentials are present.

## Run backend (hub / laptop)

```bash
npm run dev:backend
```

Env: [`packages/ac-data-backend/.env.example`](../packages/ac-data-backend/.env.example).

**HUD routing (multi-VPS, no per-VPS URLs in the overlay):**

- ProjectD-HUD uses a single `API_BASE_URL` pointing at the **hub**.
- On join, the overlay calls `GET /hud/bootstrap?steamId=` (no lobby name in the URL).
- The hub reads **player presence** from shared Redis (`ac:hud:presence:{steamId}`), written on `player_join` with `instanceId` and `folderSlug` (same stream as Activity). It resolves the edge via `FLEET_EDGE_REGISTRY` / **dynamic registry** (`instanceId`, or `instanceId:folderSlug` keys from edge sync). Optional legacy: `serverName` query if presence is not ready yet.
- Edges call `POST /hud/registry/sync` on startup and after each config snapshot. Optional override: static `HUD_EDGE_REGISTRY` JSON.
- HTTP snapshots stay on the hub (`/hud/snapshot` → gateway proxy). **WebSocket** uses `ws.primary` from bootstrap (direct to `EDGE_PUBLIC_BASE_URL` on the regional VPS); `ws.fallback` is the hub WSS proxy.

Hub env:

```bash
FLEET_EDGE_REGISTRY='{"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2"}}'
HUD_PUBLIC_BASE_URL=https://api.projectd.space
REDIS_HOST=…   # persists ac:hud:registry:state between hub restarts
# HUD_EDGE_REGISTRY=…  # optional manual lobby→edge override
```

Edge env (each VPS):

```bash
EDGE_REGISTRY_BASE_URL=http://10.0.0.2:3000   # private URL hub uses to proxy HTTP/admin
EDGE_PUBLIC_BASE_URL=https://eu-api.projectd.space   # player WSS + TLS
```

Duplicate lobby `NAME=` on **different VPS** is OK (routing uses `instanceId` from join telemetry). Duplicate `NAME=` on the **same** edge is still ambiguous until telemetry sends a stable folder slug.

## Central admin (unified hub UI)

- Public URL: **backend hub only** (`/admin/login`, dashboard).
- **Activity** and **Servers**: merged tables across all VPS (optional **Region filter** in header — not a required VPS picker).
- **Content** and **ProjectD-HUD releases**: served from the hub when `HUB_OWNS_CONTENT=true` (default in fleet mode). Set `CONTENT_PATH` on the hub.
- **Per-server manage** (table **Manage**): lifecycle (start/stop/restart), lobby/`server_cfg.ini` fields, and CM branding. Admin calls `GET/POST /admin/servers/:name/{runtime|start|stop|restart}` and `PUT .../config` on the hub; the hub **proxies to the edge** using each row’s `fleetEdgeId` (same as config).
- **Add instance**: `POST /admin/servers/provision` on the edge (proxied). Pick a **Region** in the header first in fleet mode; clones `server-templates/server-template` (or `servers/server`) to the next `server-N` folder with default ports.
- **Bulk branding**: **Apply branding to servers…** (checkboxes) — unchanged.
- **HUD downloads for players**: `GET /client/hud/latest` **only on the hub** (`PROJECTD_HUD_PATH`, included in `ac-data-backend-hub` tarball). Edge does not mount `/client/hud/*`.
- **Mods**: upload ZIPs via admin **Cars / Tracks → Upload to VPS**; Sync/copy between edges uses peer pull (see [MOD_DISTRIBUTION.md](MOD_DISTRIBUTION.md)).

Hub env: `FLEET_EDGE_REGISTRY`, `HUB_OWNS_CONTENT=true`, `CONTENT_PATH`, `CONVEX_WORKER_SECRET`.

Each **edge** keeps JSON `/admin/*` on a private address for proxied server operations (worker secret only). The admin HTML UI (`views/` / `public/`) lives exclusively on the hub.

Firewall checklist:

- Hub → edge TCP to ac-data port (e.g. 3000) on private IPs only.
- Same `CONVEX_WORKER_SECRET` on hub and all edges.

## Webhooks (ProjectD / Convex)

**Hub-centric:** point Convex HTTP actions at the **hub** base URL:

- `POST {HUB}/hud/worker/refresh-user` — body: `steamId`, `instanceId`, `workerSecret`
- `POST {HUB}/hud/worker/refresh-config` — body: `instanceId`, optional `configVersion`
- `POST {HUB}/v1/internal/desired-config` — Control API: validate track/cars vs mods snapshot, then push config (see [CONTROL_API_V1.md](CONTROL_API_V1.md))

**Legacy (single edge):** webhooks can still target the edge URL directly.

- Laps: edge → `POST /worker/ingest-events` on hub when `BACKEND_INGEST_URL` is set.
- Live roster / mods for Host: `GET {HUB}/v1/servers/:id/live`, `GET {HUB}/v1/instances/:id/mods/*` via Convex Action BFF.

## Dev: backend on PC, edge on VPS

1. Expose backend (`BACKEND_INGEST_URL` reachable from VPS).
2. Registry points each lobby name to the edge HTTP(S) URL.
3. Overlay uses backend public URL only.

## Scripts

- `./start.sh dev` — telemetry + **edge** (default).
- `./start.sh dev backend` — backend only (no telemetry).
- `./start.sh dev all` — edge + backend (local gateway testing).

## Related

- [CONTROL_API_V1.md](CONTROL_API_V1.md) — hub `/v1` live roster + mods inventory for ProjectD Host (no Convex live_players / manual mod catalogs)
- [HUD_HARDENING_CUTOVER.md](HUD_HARDENING_CUTOVER.md) — WSS + `LIVE_INGEST_CONVEX=false`
- [VPS_FLEET_SETUP.md](VPS_FLEET_SETUP.md) — production checklist, IDs, shared Redis, smoke tests
- [AC_DATA.md](AC_DATA.md)

## Package map (DX — do not merge)

| Concern | Package / path |
|---------|----------------|
| Spawn AC, telemetry → Redis, HUD WSS, presence write, mod agent, mods scan | `packages/ac-data-edge` |
| Convex ingest, Control API `/v1`, admin, mod catalog Postgres, HUD gateway | `packages/ac-data-backend` |
| Worker auth, fleet registry, Convex query helpers, env load | `packages/ac-data-shared` |

| Env “mode” | Effect |
|------------|--------|
| Edge `BACKEND_INGEST_URL` set | Hub-centric ingest/worker (no Convex SDK on edge) |
| `REDIS_CONFIG_SYNC_ON_EDGE=false` | Config pushed from hub |
| `MOD_AGENT_ENABLED=true` | Materialize mods on VPS (peer pull / local blob) |
| `LIVE_INGEST_CONVEX=false` | Join/leave/status stay Redis-only |
| Hub `FLEET_EDGE_REGISTRY` | Multi-VPS proxy + webhooks |

**Decision:** keep two deployables + shared lib. Improve docs/DX; do not reunify into one app in this cycle.
