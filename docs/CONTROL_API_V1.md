# Control API v1 — mods + live (hub)

**Audience:** `ac-data-backend` (hub) + `ac-data-edge` (per VPS) + ProjectD Host BFF.  
**Goal:** The web **reads** installed mods and live lobby rosters from the hub. Convex stays auth / presets / laps / battles — **not** a store for disk inventory or ephemeral presence.

Related: [MULTI_REGION_EDGE.md](./MULTI_REGION_EDGE.md), [MOD_DISTRIBUTION.md](./MOD_DISTRIBUTION.md), [VPS_FLEET_SETUP.md](./VPS_FLEET_SETUP.md), [HUD_HARDENING_CUTOVER.md](./HUD_HARDENING_CUTOVER.md).

**OpenAPI:** [openapi/control-api-v1.yaml](./openapi/control-api-v1.yaml)

---

## Topology

| Component | Role |
|-----------|------|
| **Hub** (`ac-data-backend`) | Control API `/v1/*`: live + mods reads; agent writes; desired-config webhook |
| **Edge** (`ac-data-edge`) | Writes Redis presence/roster; scans `CONTENT_PATH` → POST mods snapshot; applies config |
| **Redis** | Ephemeral: `ac:hud:presence:*`, `instance:{id}:mods:*` |
| **Convex** | Auth, presets, lap/battle ingest. Optional: stop join/leave/`server_status` via `LIVE_INGEST_CONVEX=false` |

`CONTROL_API_URL` / `AC_DATA_BASE_URL` = hub public base URL (same process as today).

---

## Auth (phase 1)

| Caller | Auth |
|--------|------|
| Edge agent → hub | `X-Worker-Secret` (+ `instanceId` / `X-Edge-Id` where required) |
| ProjectD Host → hub | **Convex Action BFF** with worker secret server-side (browser never sees it) |
| Convex → hub (desired-config) | `X-Worker-Secret` |

Phase 2 (optional): Clerk JWT or short-lived token from Convex Action.

---

## Agent presence (register / heartbeat)

Edge reports liveness to the hub (Redis key `instance:{instanceId}:agent`, TTL ~90s). Distinct from mod-agent ZIP sync (`/mod-agent/v1/*`).

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/v1/agents/register` | Edge on boot |
| `POST` | `/v1/agents/heartbeat` | Edge every `CONTROL_API_AGENT_HEARTBEAT_MS` (default 20s) |
| `GET` | `/v1/agents/:instanceId` | Debug / ops |

Body (register/heartbeat):

```json
{
  "instanceId": "vps-eu-2",
  "region": "eu",
  "agentVersion": "1.0.0",
  "servers": [{ "serverId": "…", "name": "SERVER_1", "status": "live", "playerCount": 2 }]
}
```

Disable on edge: `CONTROL_API_AGENT_PRESENCE_ENABLED=false`.

---

## Live

### Write path (edge → shared Redis)

There is **no** `POST /v1/agents/.../live`. Telemetry → Redis `ac:events` → edge bridge writes HUD keys; hub GETs only read them. Hub and every edge must share the same Redis (see [VPS_FLEET_SETUP.md](./VPS_FLEET_SETUP.md)).

- `player_join` / `player_leave` / `server_status` → `hudPlayerPresence` Redis keys
- Presence: `ac:hud:presence:{steamId}` (includes `name` when known)
- Roster: `ac:hud:presence:roster:{instanceId}:{normalizedServerName}` — **replaced** on `server_status` (not union). Legacy unscoped `…:roster:{name}` still readable.

### `serverId` contract (lobby name ≠ Convex `_id`)

| Layer | Meaning of `serverId` |
|-------|------------------------|
| Redis roster key / `GET /v1/servers/:serverId/live` | **Normalized AC lobby name** (e.g. `ProjectD`) |
| Convex `servers._id` | Product document id — **not** the hub live key |

ProjectD Host must map `servers._id` → lobby name (see ProjectD `EDGE_SERVER_ID_MAP`) before calling the BFF. Always pass `?instanceId=` (or path `instanceId:lobby`) on multi-VPS. Calling live with a raw Convex `_id` yields empty roster (`ok: true`, `players: []`, `updatedAt: null`), not 404.

`GET /v1/live/summary` returns the same lobby-name `serverId` values; Browse joins to Convex server rows via that map.

### Read path (hub)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/servers/:serverId/live` | Roster for one **lobby name**. Prefer `?instanceId=` or `instanceId:lobby`. Without instanceId the hub SCANs scoped keys `roster:*:{lobby}`. |
| `GET` | `/v1/live/summary` | `{ servers: [{ serverId, instanceId, playerCount, updatedAt, ip, httpPort, joinUrl }] }` (`serverId` = lobby name) |

Auth: `X-Worker-Secret`.

Response shape (`/live`):

```json
{
  "ok": true,
  "serverId": "ProjectD",
  "instanceId": "vps-eu-2",
  "players": [
    {
      "steamId": "7656…",
      "name": "Driver",
      "carModel": "ks_toyota_gt86",
      "track": "ks_nordschleife",
      "trackConfig": "",
      "instanceId": "vps-eu-2",
      "folderSlug": "server-1",
      "updatedAt": 1710000000000
    }
  ],
  "updatedAt": 1710000000000,
  "ip": "13.140.160.131",
  "httpPort": 8081,
  "joinUrl": "https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8081"
}
```

Join fields (`ip` / `httpPort` / `joinUrl`) are nullable. Resolved from `FLEET_EDGE_REGISTRY` (`joinIp` or public hostname of `baseUrl`) + edge branding `HTTP_PORT`. When `baseUrl` is private, set `joinIp` on the registry entry. Host can show a Share button with `joinUrl`.

### Convex ingest flag

On edge: `LIVE_INGEST_CONVEX=false` keeps join/leave/`server_status` **local** (Redis/HUD only). Laps and battles still forward to Convex via hub ingest.

Default remains `true` until ProjectD Host reads live from Control API.

---

## Central mod library (Host picker — preferred)

Source of truth: Hub Postgres `mod_packages` + `mod_artifacts` (catalog metadata).
ZIP bytes live on game VPS (`storage_origin=edge`); leftover hub master blobs are read/delete only.
Local cache on each VPS is separate; availability merges central + edge inventory + sync jobs.

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/v1/mods` | Host BFF — catalog (`?kind=car|track`) |
| `GET` | `/v1/mods/:slug` | Host BFF — one package + all versions |
| `GET` | `/v1/mods/availability?instanceId=` | Host BFF — `central: AVAILABLE` + `local: LOCAL|MISSING|DOWNLOADING|INSTALLING|ERROR` |
| `POST` | `/v1/instances/:instanceId/mods/ensure` | Host BFF — idempotent materialize |

Ensure body (either form):

```json
{ "artifactIds": ["uuid…"] }
```

```json
{
  "cars": [{ "modId": "bmw_m3_e30", "version": "1.4" }],
  "tracks": [{ "modId": "otarumi_touge", "version": "1.2" }]
}
```

`modId` may be package UUID, package `slug`, or `ac_content_slug`. Omit `version` → latest artifact (legacy presets). Same edge + artifact + active job → **reuse** job (no duplicate downloads).

Catalog item shape:

```json
{
  "id": "…",
  "slug": "otarumi_touge",
  "kind": "track",
  "name": "Otarumi Touge",
  "acContentSlug": "otarumi_touge",
  "imageUrl": "https://hub.example.com/mods/images/….jpg",
  "versions": [
    { "version": "1.2", "artifactId": "…", "sha256": "…", "size": 234567 }
  ]
}
```

Host must **not** build the library from per-VPS inventory alone. Combine `GET /v1/mods` + `GET /v1/mods/availability`.

Slot start/restart on the hub runs ensure + wait (`MOD_ENSURE_WAIT_MS`) before proxying AC start. Edge `startGate` remains a second check.

See [MOD_DISTRIBUTION.md](./MOD_DISTRIBUTION.md).

---

## Mods inventory (legacy LOCAL CONTENT — cutover)

**Deprecated for Host library UI.** Still valid as observed disk inventory (Redis). Distinct from the central library.

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/v1/agents/:instanceId/mods` | Edge scan → hub Redis |
| `GET` | `/v1/instances/:instanceId/mods/cars` | Legacy Host BFF |
| `GET` | `/v1/instances/:instanceId/mods/tracks` | Legacy Host BFF |

Redis keys:

- `instance:{instanceId}:mods:cars`
- `instance:{instanceId}:mods:tracks`
- `instance:{instanceId}:mods:meta` (`etag`, `scannedAt`)

POST body:

```json
{
  "etag": "optional-hash",
  "cars": [{ "carModel": "ks_toyota_gt86", "displayName": "…", "skins": ["0_default"], "version": "optional", "artifactId": "optional", "sha256": "optional" }],
  "tracks": [{ "trackSlug": "ks_nordschleife", "configs": ["", "layout"], "version": "optional", "artifactId": "optional", "sha256": "optional" }]
}
```

Optional enrich fields are only present when the edge knows them (e.g. `.acmod.json` sidecar). Do not invent versions.

Edge: periodic scan of `CONTENT_PATH/cars|tracks` (env `MOD_INVENTORY_SCAN_MS`, default 15 min; also on boot).

---

## Desired config (phase 3)


| Method | Path | Who |
|--------|------|-----|
| `POST` | `/v1/internal/desired-config` | Convex webhook |

Body:

```json
{
  "instanceId": "vps-eu-2",
  "serverId": "optional-filter",
  "configVersion": "optional",
  "reason": "preset_start",
  "config": { "/* optional full snapshot override */": true }
}
```

Handler:

1. Load snapshot from body **or** Convex `timeAttackServers:getWorkerInstanceServerConfigs`.
2. Validate `track` + `entries[].model` against Redis mods snapshot for `instanceId`.
3. Push to edge (`/hud/worker/push-config-snapshot`) or hub Redis `ac:config`.
4. Return `{ ok, errors?: ["track_not_installed:…", "car_not_installed:…"] }`.

Existing `POST /hud/worker/refresh-config` remains for migration.

---

## Server slots platform (Host allocate)

Postgres table `server_slots` (migration `003_server_slots.sql`, needs `DATABASE_URL`) is the **operational SoT** for physical lobbies. Convex keeps presets/auth; Host picks **region + preset** → hub allocate → apply-config → start.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/servers` | List slots (`?region=&status=idle&instanceId=`) |
| `POST` | `/v1/servers` | Upsert/bootstrap slot (`instanceId`, `region`, `lobbyName`, `folderSlug`) |
| `POST` | `/v1/servers/allocate` | `{ region, presetRef? }` → idle slot → `allocated` |
| `GET` | `/v1/servers/:slotId` | Slot detail + `appliedConfig` |
| `POST` | `/v1/servers/:slotId/apply-config` | Validate mods + push (same as desired-config for that lobby) |
| `POST` | `/v1/servers/:slotId/start\|stop\|restart` | Proxy to edge `/admin/servers/{folderSlug}/…` |

Agent register/heartbeat with `servers[]` upserts/syncs `playerCount` / status when `DATABASE_URL` is set.

Live roster path `/v1/servers/:lobbyName/live` is unchanged (Redis). Do not confuse lobby name with slot UUID.

Full Host flow: [SERVER_PLATFORM.md](./SERVER_PLATFORM.md).

---

## ProjectD Host consumption

1. Set `CONTROL_API_URL` + `CONVEX_WORKER_SECRET` on the **Next.js server** (Vercel), not in the browser.
2. Host UI calls `/api/control/*` Route Handlers (Clerk) — not the hub directly, not Convex Actions as hub proxy.
3. Handlers call hub `GET/POST /v1/...` with `X-Worker-Secret`.

Example Host BFF (Next.js): [`docs/examples/PROJECTD_BFF_INSTALL.md`](./examples/PROJECTD_BFF_INSTALL.md).  
Live ingest flag: [`HUD_HARDENING_CUTOVER.md`](./HUD_HARDENING_CUTOVER.md) (`LIVE_INGEST_CONVEX=false`).

Stop writing car/track catalogs by hand in Convex; stop querying `live_players` for Host dashboards once live GETs are wired.

---

## Env cheat sheet

**Edge**

```bash
LIVE_INGEST_CONVEX=false          # after Host reads live from hub
MOD_INVENTORY_SCAN_ENABLED=true
MOD_INVENTORY_SCAN_MS=900000
CONTROL_API_AGENT_PRESENCE_ENABLED=true
CONTROL_API_AGENT_HEARTBEAT_MS=20000
BACKEND_INGEST_URL=https://hub…   # POST mods / register / heartbeat
CONTENT_PATH=/path/to/content
AC_INSTANCE_ID=vps-eu-2
CONVEX_WORKER_SECRET=…
```

**Hub**

```bash
CONVEX_WORKER_SECRET=…
DATABASE_URL=postgres://…         # mods + server_slots
REDIS_HOST=…
FLEET_EDGE_REGISTRY=…
# CONTROL_API is this process — no extra service
```

**ProjectD (Next.js server env)**

```bash
CONTROL_API_URL=https://hub…
CONVEX_WORKER_SECRET=…            # Next /api/control BFF only — never NEXT_PUBLIC_
```

---

## Success criteria

1. Host shows the **central** car/track library via `/v1/mods`, with per-VPS badges from `/v1/mods/availability`.
2. Legacy inventory GETs still work during cutover; Host must not treat them as the global library.
3. Live roster via hub GET is &lt; ~10s stale; no `live_players` query for Host.
4. Laps / battles / HUD WSS still work.
5. Multiple `AC_INSTANCE_ID` values report to one Control API.
6. Host can allocate idle slot by region, ensure mods LOCAL, apply config, start/stop via Control API.
7. AC never downloads from Hub/S3 during a race — only local `CONTENT_PATH`.
