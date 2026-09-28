# VPS fleet setup (hub + edges)

Checklist to run **one hub** (`ac-data-backend`) against **N game VPS** (`ac-data-edge`).  
Related: [MULTI_REGION_EDGE.md](./MULTI_REGION_EDGE.md), [CONTROL_API_V1.md](./CONTROL_API_V1.md), [MOD_DISTRIBUTION.md](./MOD_DISTRIBUTION.md).

**Do not merge** edge/backend into one package for this setup — use env modes below.

---

## Critical: shared Redis

Presence, HUD bootstrap, and Control API live reads use Redis keys `ac:hud:presence:*`.

| Topology | Result |
|----------|--------|
| **Same Redis** for hub + all edges | Live `/v1/.../live`, HUD bootstrap, multi-VPS OK |
| Redis only on each VPS | Hub live GETs empty; HUD routing broken |

Mods inventory (`instance:{id}:mods:*`) is written by the **hub** when edges POST snapshots — that path does not need edge→hub Redis for the POST itself, but live still does.

---

## ID alignment (footgun #1)

| ID | Example | Where it must match |
|----|---------|---------------------|
| Fleet registry **key** | `eu` | `FLEET_EDGE_REGISTRY` key = edge `EDGE_ID` (mod agent) |
| `instanceId` | `vps-eu-2` | Registry `instanceId` = edge `AC_INSTANCE_ID` = Convex `vps_hosts.instanceId` |

```json
{
  "eu": {
    "label": "EU",
    "baseUrl": "http://10.0.0.2:3000",
    "instanceId": "vps-eu-2"
  }
}
```

Mismatch → `edge_not_found` on webhooks / wrong mod agent / empty Control API inventory for Host.

---

## Hub env (minimum)

```bash
PORT=3000
CONVEX_DEPLOYMENT_URL=…
CONVEX_PRODUCT_KEY=…
CONVEX_INGEST_SECRET=…
CONVEX_WORKER_SECRET=…          # shared with every edge

REDIS_HOST=…                    # SHARED with edges
REDIS_PORT=6379

FLEET_EDGE_REGISTRY={"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2"}}
HUD_PUBLIC_BASE_URL=https://api.example.com

# Loading / banner images (admin Upload → data/branding, public GET /branding/images/:file)
# BRANDING_IMAGES_PATH=/var/lib/ac-data/branding   # default: sibling of CONTENT_PATH named branding

HUB_OWNS_CONTENT=true
CONTENT_PATH=/path/to/content   # optional hub library

# Mod distribution (optional but recommended)
DATABASE_URL=postgres://…
MOD_UPLOAD_ROOT=/var/lib/ac-data/mod-uploads
MOD_STORAGE_MODE=local          # or s3
MOD_HUB_PUBLIC_URL=https://api.example.com
```

Deploy: [deploy/backend-hub/README.md](../deploy/backend-hub/README.md) or monorepo `npm run build:backend && npm run start -w @projectd/ac-data-backend`.

---

## Edge env (each VPS)

```bash
AC_INSTANCE_ID=vps-eu-2         # = registry instanceId
EDGE_ID=eu                      # = registry key (mod agent)
SERVERS_PATH=/path/to/servers
CONTENT_PATH=/var/lib/ac-mods/pool

BACKEND_INGEST_URL=https://api.example.com
# BACKEND_WORKER_URL=…          # defaults to BACKEND_INGEST_URL
CONVEX_WORKER_SECRET=…          # same as hub — NO Convex SDK creds on edge

REDIS_HOST=…                    # SAME as hub
REDIS_CONFIG_SYNC_ON_EDGE=false
REDIS_CONFIG_APPLIER_ENABLED=true
REDIS_EVENTS_BRIDGE_ENABLED=true

EDGE_REGISTRY_BASE_URL=http://10.0.0.2:3000   # private URL hub uses
EDGE_PUBLIC_BASE_URL=https://eu-api.example.com  # player HUD WSS

MOD_AGENT_ENABLED=true
MOD_INVENTORY_SCAN_ENABLED=true

# After ProjectD Host reads Control API live:
# LIVE_INGEST_CONVEX=false
```

Symlink AC content into the mod pool when using distribution (see edge README).

---

## Convex / ProjectD

```bash
CONTROL_API_URL=https://api.example.com   # hub public URL (Next.js server env)
AC_DATA_BASE_URL=https://api.example.com  # legacy alias OK
CONVEX_WORKER_SECRET=…                    # Next BFF only — never in browser / NEXT_PUBLIC_
```

Webhooks (HTTP actions) → **hub**:

- `POST {HUB}/hud/worker/refresh-user`
- `POST {HUB}/hud/worker/refresh-config`
- `POST {HUB}/v1/internal/desired-config` (optional; validates mods snapshot)

BFF Host (Next.js): [examples/PROJECTD_BFF_INSTALL.md](./examples/PROJECTD_BFF_INSTALL.md).  
Host cutover: [CONTROL_API_HOST_CUTOVER.md](./CONTROL_API_HOST_CUTOVER.md).

---

## Smoke tests

Run after deploy (replace URLs/secrets).

### 1. Health

```bash
curl -sS https://api.example.com/api/health
# each edge:
curl -sS http://10.0.0.2:3000/api/health
```

### 2. Ingest path (lap / battle)

Join a session on an edge; confirm hub logs ingest and Convex receives lap/battle events.

### 3. HUD bootstrap

```bash
curl -sS "https://api.example.com/hud/bootstrap?steamId=STEAM64" -H "x-api-key: $HUD_API_KEY"
```

Expect presence-backed routing when the player is online (shared Redis).

### 4. Control API live

```bash
curl -sS "https://api.example.com/v1/live/summary" \
  -H "X-Worker-Secret: $CONVEX_WORKER_SECRET"
curl -sS "https://api.example.com/v1/servers/LOBBY_NAME/live?instanceId=vps-eu-2" \
  -H "X-Worker-Secret: $CONVEX_WORKER_SECRET"
# Without instanceId the hub discovers scoped roster keys (fleet-safe).
```

Non-empty when players are in that lobby and Redis is shared.

### 5. Mods inventory (layer A)

After edge scan (boot + `MOD_INVENTORY_SCAN_MS`):

```bash
curl -sS "https://api.example.com/v1/instances/vps-eu-2/mods/cars" \
  -H "X-Worker-Secret: $CONVEX_WORKER_SECRET"
```

### 6. Mod agent (layer B)

On edge logs: `[mod-agent] started` + heartbeats.  
Admin → **Mod distribution** → edges show recent `last_seen`; sync a test ZIP → status `READY` (not stuck `PENDING`).

### 7. Config webhook

```bash
curl -sS -X POST "https://api.example.com/hud/worker/refresh-config" \
  -H "Content-Type: application/json" \
  -d "{\"workerSecret\":\"$CONVEX_WORKER_SECRET\",\"instanceId\":\"vps-eu-2\"}"
```

Expect `mode: edge_push` when registry resolves the edge.

---

## Lobby names

Live roster keys are scoped by **`instanceId` + normalized lobby name** (`ac:hud:presence:roster:{instanceId}:{lobby}`).  
Duplicate `NAME=` across VPS is OK when Host passes `?instanceId=` or uses composite `instanceId:LobbyName`.
