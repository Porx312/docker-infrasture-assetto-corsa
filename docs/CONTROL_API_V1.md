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

Edge reports liveness to the hub (Redis key `instance:{instanceId}:agent`, TTL ~90s). Distinct from mod-agent tree/blob sync (`/mod-agent/v1/*`).

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
  "servers": [{
    "serverId": "SERVER_1",
    "name": "SERVER_1",
    "status": "starting",
    "playerCount": 0,
    "phase": "PREPARING",
    "phaseDetail": "waiting for 2 mod(s)",
    "phaseUpdatedAt": 1710000000000
  }]
}
```

### Server lifecycle phases (Host startup UI)

Brief para el equipo Host (copiar/enviar): [examples/HOST_SERVER_LIFECYCLE.md](./examples/HOST_SERVER_LIFECYCLE.md).

`POST /v1/internal/desired-config` `{ ok: true }` means the snapshot was **accepted and pushed** — **not** that `acServer` is online. Host must poll `GET /v1/agents/:instanceId` and wait for the lobby slot:

| `phase` | Coarse `status` | Meaning |
|---------|-----------------|---------|
| `PREPARING` | `starting` | Mod gate / CONTENT_PATH wait |
| `CONFIGURING` | `starting` | Apply INI / branding |
| `STARTING` | `starting` | Spawn / restart process |
| `CHECKING` | `starting` | Verify process / ports |
| `ONLINE` | `live` | Ready for joins |
| `FAILED` | `error` | Terminal failure (`phaseDetail` has reason) |

Omit `phase` / `phaseDetail` / `phaseUpdatedAt` when the server is genuinely idle/stopped (or older edge without lifecycle). **Missing phase ≠ ONLINE.** Phase changes force an immediate heartbeat (not only the ~20s interval). `phaseUpdatedAt` is Unix **ms**.

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
Content lives on each game VPS under `CONTENT_PATH` (`storage_origin=edge_folder`). Peer copy uses slim tree tar; leftover `edge`/`hub` ZIP rows are read-only until re-adopt/GC.
Local inventory on each VPS is separate; availability merges central + edge inventory + sync jobs.

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/v1/mods` | Host BFF — catalog (`?kind=car|track`) |
| `GET` | `/v1/mods/:slug` | Host BFF — one package + all versions |
| `GET` | `/v1/mods/availability?instanceId=` | Host BFF — `central: AVAILABLE` + `local: LOCAL|MISSING|DOWNLOADING|INSTALLING|ERROR` |
| `POST` | `/v1/instances/:instanceId/mods/ensure` | Host BFF — idempotent materialize |

### User library (steamId links — Contabo S3)

Convex Action BFF uploads user mods here. **Hub stores blobs + `mod_steam_links`.** Convex does **not** store mod metadata — only auth + `steamId`. Same content hash → `already_present` and a new link (no second S3 object). If the folder **slug is already taken** but the slim tree is **different** (tuned car / edited track), the hub allocates `{slug}-c1`, `{slug}-c2`, … and returns `slugAllocated: true` + final `slug` / `acContentSlug` (no silent replace). User uploads do **not** sync to the public host-catalog.

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/v1/mods/library/slim-upload/plan` | **Host preferred** — browser/BFF slim scan; body `steamId` + manifest + `expectedContentHash` |
| `PUT` | `/v1/mods/library/slim-upload/file` | **Host preferred** — raw body; headers `X-Slim-Session-Id`, `X-Slim-Rel`, `X-Slim-Sha256` |
| `POST` | `/v1/mods/library/slim-upload/commit` | **Host preferred** — `{ sessionId, steamId }` → S3 + link |
| `POST` | `/v1/mods/library/zip-upload` | **Host fallback** — multipart ZIP; hub does slim/hash/S3/link |
| `GET` | `/v1/mods/library/by-steam/:steamId` | Convex — list linked packages |
| `DELETE` | `/v1/mods/library/:packageId` | Convex — body/query `steamId`; always unlink; purge only if last link and not on servers |

**Slim upload (Host preferred):** browser slim-scan (`scanZipForSlimUpload` en el paquete Host `@projectd/ac-mod-slim-client`); BFF proxies plan/file/commit with worker secret. Plan may return `already_present` (link only) or `need_upload` + `sessionId` (includes final `slug`, `requestedSlug`, `slugAllocated`).

**ZIP upload (fallback):** `multipart/form-data` fields `file`, `steamId`, `kind` (`car`\|`track`), optional `slug`, `displayName`. Hub extracts, filters server-slim paths, dedupes by content hash, may allocate `-cN` slug, links steamId.

Full Host contracts: cars — [PROJECTD_CUSTOM_CARS_HOST.md](./PROJECTD_CUSTOM_CARS_HOST.md); tracks — [PROJECTD_CUSTOM_TRACKS_HOST.md](./PROJECTD_CUSTOM_TRACKS_HOST.md).

Caps: `CONTROL_MOD_UPLOAD_MAX_BYTES` (default 500MB), `CONTROL_MOD_UPLOAD_MAX_FILES` (default 5000).

Delete: always removes `(steamId, packageId)` so the user leaves “my library”. If other steamIds still link → blob stays (`unlinked`). If last link and no **running** requiring server → purge S3+VPS+hub package (`purged`); Convex host-catalog slug is **kept**. If last link but a requiring server is still **live** (or presence unknown) → link removed, package kept (`unlinked` + `purgeSkipped: "mod_in_use"`). Idle/stopped servers that still list the mod in config do **not** block purge. Does **not** return 409 for user list removal.

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

### Optional per-server fields (Host / Convex snapshot rows)

Convex `getWorkerInstanceServerConfigs` (and desired-config `servers[]`) may include:

| Field | Type | Edge effect |
|-------|------|-------------|
| `timeOfDay` | `"day"` \| `"night"` \| `"dynamic"` | Writes `SUN_ANGLE` + `TIME_OF_DAY_MULT` (`day` 16/1, `night` -80/1, `dynamic` 16/5) |
| `tyreBlanketsAllowed` | `boolean` | `TYRE_BLANKETS_ALLOWED=0\|1` |

These enter the config signature (restart when they change). Host owns the values in Convex; infra only applies them. Battle eligibility stays driven by snapshot `type` / name heuristic (all servers can still use the battle system).

Existing `POST /hud/worker/refresh-config` remains for migration.

---

## Host ops slots — retired

**Removed** from the hub Control API: `GET/POST /v1/servers` (slots), `POST /v1/servers/allocate`, and `POST /v1/servers/:slotId/apply-config|start|stop|restart`.

| Concern | Path now |
|---------|----------|
| Start / stop (product) | Convex → Redis desired-config → edge |
| Start / stop (ops UI) | Hub `/admin/servers/:name/start\|stop` |
| Live roster | `GET /v1/servers/:lobbyName/live` (Redis) — **unchanged** |

Postgres table `server_slots` (migration `003`) may still exist in DB; hub code no longer reads or writes it. See [SERVER_PLATFORM.md](./SERVER_PLATFORM.md).

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
DATABASE_URL=postgres://…         # mods catalog (server_slots table unused by API)
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
6. Host start = Convex → Redis desired-config; live = hub; ops start/stop = `/admin/servers/*` (Host ops slots API retired).
7. AC never downloads from Hub/S3 during a race — only local `CONTENT_PATH`.
