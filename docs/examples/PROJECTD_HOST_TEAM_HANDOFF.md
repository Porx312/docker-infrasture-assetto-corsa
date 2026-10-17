# ProjectD Host — team handoff (servers + mods)

**Where to implement:** ProjectD repo (Next.js Host), **not** `assetto-infra`.  
**Hub contracts:** [CONTROL_API_V1.md](../CONTROL_API_V1.md), [SERVER_PLATFORM.md](../SERVER_PLATFORM.md), [MOD_DISTRIBUTION.md](../MOD_DISTRIBUTION.md), [HUD_HARDENING_CUTOVER.md](../HUD_HARDENING_CUTOVER.md), OpenAPI [openapi/control-api-v1.yaml](../openapi/control-api-v1.yaml), short install [PROJECTD_BFF_INSTALL.md](./PROJECTD_BFF_INSTALL.md).

Paste this file (or the Cursor prompt in §7) into a ProjectD chat. Do not implement Host UI inside assetto-infra.

**Start here:** [PROJECTD_WEB_CONVEX_HUB_HANDOFF.md](./PROJECTD_WEB_CONVEX_HUB_HANDOFF.md) — Convex workers + Redis start; hub ≈ **live** players.  
**Catalog sync hub→Convex:** [HOST_CATALOG_SYNC.md](../HOST_CATALOG_SYNC.md).  
**Host ops slots retired:** no `allocate` / `/v1/servers/:slotId/*` — start = Convex→Redis; live = hub; ops UI = `/admin/servers/*`.

---

## 1. Mental model (one sentence)

> Convex owns product catalog + start (Redis desired-config); hub owns **live roster** (and ZIP ensure when disk is empty). Host ops `/v1/servers` slots API is **retired**.

```text
Host UI → Convex (catalog/start) + /api/control (live only)
Ops UI  → /admin/servers/:name/start|stop
```

| Concept | What it is | Host reads/writes |
|---------|------------|-------------------|
| **Product catalog** | Convex `battle_cars` / `battle_tracks` / `servers` | Convex queries + workers |
| **Central ZIP library (ops)** | Hub Postgres `mod_packages` + artifacts | `GET /v1/mods` when ops flag on |
| **Local cache** | Materialized content on that VPS | via `availability` / `ensure` |
| **Inventory** | Disk observation (Redis scan) | skins / layouts when LOCAL — **not** the library list |
| **Start** | Convex `servers` + Redis desired-config | See [PROJECTD_WEB_CONVEX_HUB_HANDOFF.md](./PROJECTD_WEB_CONVEX_HUB_HANDOFF.md) — **no** hub allocate |

Convex remains: auth, presets, laps/battles. **Not** `live_players` for Host dashboards after cutover (`LIVE_INGEST_CONVEX=false`).

---

## 2. Env (server only — Vercel / `.env.local`)

```bash
CONTROL_API_URL=https://hub.example.com
CONVEX_WORKER_SECRET=…   # same as hub X-Worker-Secret; NEVER NEXT_PUBLIC_
# CONTROL_API_HOST_OPS=true   # optional hub mod catalog extras only
```

Browser calls Convex (catalog/auth/start) and **`/api/control/*`** for hub live. DevTools must never show the hub hostname or worker secret.

---

## 3. BFF to implement

**Required:** live (+ optional ensure). Do **not** wire allocate / slot lifecycle — those routes are retired.

1. `src/lib/controlApi/server.ts` — Clerk `requireUser` + `controlGet` / `controlPost` (header `X-Worker-Secret`, base `CONTROL_API_URL`).
2. Route Handlers under `app/api/control/...` that mirror hub `/v1/...`.

| Host need | BFF → hub | When |
|-----------|-----------|------|
| Live roster | `GET /v1/servers/:lobbyName/live?instanceId=` | Always |
| Live summary | `GET /v1/live/summary` | Always |
| Share / join link | Same live responses → `joinUrl` (acstuff `ip` + `httpPort`) | Always |
| Mod catalog | `GET /v1/mods?kind=car\|track` | Ops only |
| Detail + versions | `GET /v1/mods/:slug` | Ops only |
| VPS badges | `GET /v1/mods/availability?instanceId=` | Ops only |
| Prefetch | `POST /v1/instances/:id/mods/ensure` | Ops only |
| Skins / layouts (when LOCAL) | `GET /v1/instances/:id/mods/cars\|tracks` | Ops only |

Client: Convex for catalog/start; `fetch('/api/control/…')` for live ~5s.

---

## 4. Mods UI (phase 2 / ops — hub central library)

When using hub as library UI (`CONTROL_API_HOST_OPS` or admin ops), **not** the MVP Host catalog (that is Convex).

### Correct

```text
GET /v1/mods
  +
GET /v1/mods/availability?instanceId=<AC_INSTANCE_ID>
  → table: name | imageUrl | Central AVAILABLE | VPS LOCAL|MISSING|DOWNLOADING|INSTALLING|ERROR
```

### Wrong

```text
selected VPS → GET inventory cars/tracks → “this is the library”
```

Rules:

- Exact identity: `artifactId` + `sha256` (+ `version` when present). Slug alone is **not** LOCAL.
- Old presets without `version`: ensure with `modId` = slug → hub picks **latest** artifact.
- `imageUrl` optional (hub cover); if `null`, use placeholder.
- Do not invent versions on the client.

Ensure body (either form):

```json
{
  "cars": [{ "modId": "bmw_m3_e30", "version": "1.4" }],
  "tracks": [{ "modId": "otarumi_touge", "version": "1.2" }]
}
```

```json
{ "artifactIds": ["uuid…"] }
```

`modId` may be package UUID, `slug`, or `ac_content_slug`. Response per item: `LOCAL` | `QUEUED` | `DOWNLOADING` | `INSTALLING` | `ERROR` | `NOT_FOUND`.  
Idempotent: same edge + artifact + active job → **reuse** (no triple download if ensure is spammed).

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

---

## 4b. Skins and layouts (cars / tracks)

Central catalog does **not** list skins or track layouts. Those come from **local inventory** after the mod is materialized on the VPS (`LOCAL`).

| Source | Has | Does not have |
|--------|-----|----------------|
| `GET /v1/mods` | package, versions, `imageUrl` | skins / layouts |
| `GET /v1/mods/availability` | `LOCAL` / `MISSING` / … | skins / layouts |
| `GET /v1/instances/:id/mods/cars` | `carModel`, `skins[]` | global library |
| `GET /v1/instances/:id/mods/tracks` | `trackSlug`, `configs[]` (layouts; `""` = default) | global library |

**Rule:** Host never invents skins/layouts. Read them from inventory for the slot’s `instanceId` only when the mod is `LOCAL`.

```text
GET /v1/mods  +  GET /v1/mods/availability
        │
        ▼
  browse: cover + name + badge
        │
        │  if LOCAL → configure session
        ▼
GET /v1/instances/:instanceId/mods/cars|tracks
        │
        ▼
  join: central.acContentSlug === carModel | trackSlug
        → skins[]  /  configs[]
```

### A. Library browse (global picker)

1. `GET /v1/mods?kind=car|track` → name, `imageUrl`, versions.
2. `GET /v1/mods/availability?instanceId=` → badge.
3. UI: cover + name + badge. **Do not** expand skins/layouts if `MISSING` / `DOWNLOADING`.

### B. Session config (pick skin or layout)

When the user selects a **LOCAL** car/track for the preset/server:

1. Use `acContentSlug` from the catalog.
2. Cars: `GET .../mods/cars` → find `carModel === acContentSlug` → `skins[]` → skin selector (if empty, implicit default only).
3. Tracks: `GET .../mods/tracks` → find `trackSlug === acContentSlug` → `configs[]` → layout selector (`""` or first entry = base layout).
4. If not yet `LOCAL`: Ensure → poll availability → on `LOCAL`, **refetch inventory**, then fill skins/layouts.

### C. Create / start server

```text
Convex startHostSession / setPhysicalServerActive
  → Redis desired-config
  → edge apply + start
```

Optional ops: ensure cars/tracks LOCAL before start if content may be missing on the VPS.

### D. Do not

- Call hub `allocate` / `/v1/servers/:slotId/*` (retired).
- Use inventory alone as the library list.
- Assume skins from the ZIP without inventory.
- Invent layouts if `configs` is empty (default layout only).

---

## 5. Server flow (Host UX)

```text
User picks preset / physical server (Convex)
        ↓
startHostSession → setPhysicalServerActive
        ↓
Redis desired-config → edge
        ↓
Live: GET /v1/servers/{lobbyName}/live?instanceId=
```

Notes:

- **Never** depend on Hub/S3/R2 during a race — content must already be on the VPS.
- Live path uses **lobby name** (e.g. `ProjectD`), not Convex `servers._id`. Map `_id` → lobby + `instanceId` (`AC_INSTANCE_ID`).
- Ops start/stop without Host: hub `/admin/servers/:name/start|stop`.

More detail: [SERVER_PLATFORM.md](../SERVER_PLATFORM.md).

---

## 6. Acceptance checklist

1. Browser only hits `/api/control/*` for hub (live).
2. Start via Convex + Redis desired-config — **no** hub allocate / slotId lifecycle.
3. Live roster uses lobby name + `instanceId` (hub BFF) — not Convex presence loop.
4. Hub smoke curls ([PROJECTD_BFF_INSTALL.md](./PROJECTD_BFF_INSTALL.md)) OK for **live** before UI work.
5. Optional ops: ensure LOCAL + inventory skins/layouts when using hub mod extras.

After Host no longer needs Convex `live_players`: ops sets `LIVE_INGEST_CONVEX=false` on every edge ([HUD_HARDENING_CUTOVER.md](../HUD_HARDENING_CUTOVER.md)).

---

## 7. Cursor prompt (paste into ProjectD)

```text
Implement Host per assetto-infra docs/examples/PROJECTD_WEB_CONVEX_HUB_HANDOFF.md:

- Catalog cars/tracks/servers = Convex (workerUpsert* / queries) — NOT GET /v1/mods as Host library
- Start = startHostSession → setPhysicalServerActive → Redis desired-config (Host ops slots / allocate RETIRED)
- Live = BFF GET /api/control/live/summary and /servers/:lobby/live?instanceId= (lobby name, not servers._id)
- Do NOT flood Convex with connected-user presence (LIVE_INGEST_CONVEX=false on edge after cutover)
- Optional ops: hub ensure ZIP when VPS missing content — see PROJECTD_HOST_TEAM_HANDOFF.md
- Do NOT put CONVEX_WORKER_SECRET in the browser / NEXT_PUBLIC_
- Clerk on BFF for live proxy to CONTROL_API_URL with X-Worker-Secret

Contracts: CONTROL_API_V1.md (live), SERVER_PLATFORM.md (start = Convex→Redis; live = hub)
```

---

## 8. Smoke (hub reachable)

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

# Live
curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"
# Expect nullable joinUrl like https://acstuff.club/s/q:race/online/join?ip=…&httpPort=…

# Optional ops — hub mod catalog
# curl -sS "$HUB/v1/mods" -H "X-Worker-Secret: $SECRET" | head -c 400
# curl -sS "$HUB/v1/mods/availability?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET" | head -c 400
```
