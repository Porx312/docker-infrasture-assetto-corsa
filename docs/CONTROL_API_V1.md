# Control API v1 — mods + live (hub)

**Audience:** `ac-data-backend` (hub) + `ac-data-edge` (per VPS) + ProjectD Host BFF.  
**Goal:** The web **reads** installed mods and live lobby rosters from the hub. Convex stays auth / presets / laps / battles — **not** a store for disk inventory or ephemeral presence.

Related: [MULTI_REGION_EDGE.md](./MULTI_REGION_EDGE.md), [MOD_DISTRIBUTION.md](./MOD_DISTRIBUTION.md), [CONTROL_API_HOST_CUTOVER.md](./CONTROL_API_HOST_CUTOVER.md), [VPS_FLEET_SETUP.md](./VPS_FLEET_SETUP.md), handoff alias [control-api-vps-spec.md](./control-api-vps-spec.md).

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
| `GET` | `/v1/live/summary` | `{ servers: [{ serverId, instanceId, playerCount, updatedAt }] }` (`serverId` = lobby name) |

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
  "updatedAt": 1710000000000
}
```

### Convex ingest flag

On edge: `LIVE_INGEST_CONVEX=false` keeps join/leave/`server_status` **local** (Redis/HUD only). Laps and battles still forward to Convex via hub ingest.

Default remains `true` until ProjectD Host reads live from Control API.

---

## Mods inventory (layer A — Host picker)

Distinct from **Mod distribution** (Postgres + ZIP sync = layer B / ops).

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/v1/agents/:instanceId/mods` | Edge scan → hub Redis |
| `GET` | `/v1/instances/:instanceId/mods/cars` | Host BFF |
| `GET` | `/v1/instances/:instanceId/mods/tracks` | Host BFF |

Redis keys:

- `instance:{instanceId}:mods:cars`
- `instance:{instanceId}:mods:tracks`
- `instance:{instanceId}:mods:meta` (`etag`, `scannedAt`)

POST body:

```json
{
  "etag": "optional-hash",
  "cars": [{ "carModel": "ks_toyota_gt86", "displayName": "…", "skins": ["0_default"] }],
  "tracks": [{ "trackSlug": "ks_nordschleife", "configs": ["", "tour"] }]
}
```

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
Cutover checklist: [`CONTROL_API_HOST_CUTOVER.md`](./CONTROL_API_HOST_CUTOVER.md) (includes `LIVE_INGEST_CONVEX=false`).

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

1. Host shows cars/tracks for an `instanceId` without editing Convex catalogs.
2. Live roster via hub GET is &lt; ~10s stale; no `live_players` query for Host.
3. Laps / battles / HUD WSS still work.
4. Multiple `AC_INSTANCE_ID` values report to one Control API.
5. Host can allocate idle slot by region, apply config, start/stop via Control API.
