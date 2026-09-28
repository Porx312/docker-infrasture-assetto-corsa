# ProjectD Host — team handoff (servers + mods)

**Where to implement:** ProjectD repo (Next.js Host), **not** `assetto-infra`.  
**Hub contracts:** [CONTROL_API_V1.md](../CONTROL_API_V1.md), [SERVER_PLATFORM.md](../SERVER_PLATFORM.md), [MOD_DISTRIBUTION.md](../MOD_DISTRIBUTION.md), [CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md), OpenAPI [openapi/control-api-v1.yaml](../openapi/control-api-v1.yaml), short install [PROJECTD_BFF_INSTALL.md](./PROJECTD_BFF_INSTALL.md).

Paste this file (or the Cursor prompt in §7) into a ProjectD chat. Do not implement Host UI inside assetto-infra.

---

## 1. Mental model (one sentence)

> One central mod library on the hub; each VPS only caches locally what it needs. Host combines catalog + availability for the chosen VPS; never builds the library from a VPS inventory scan.

```text
ProjectD Host UI
       │
       ▼
Next.js /api/control  (Clerk + X-Worker-Secret)
       │
       ▼
Hub Control API /v1/*
       │
       ├── central library (Postgres + object storage)
       └── ensure → VPS local cache → AC
```

| Concept | What it is | Host reads/writes |
|---------|------------|-------------------|
| **Central library** | Hub Postgres `mod_packages` + `mod_artifacts` | `GET /v1/mods` |
| **Local cache** | Materialized content on that VPS | via `availability` / `ensure` |
| **Inventory** | Disk observation (Redis scan) | skins / layouts when LOCAL — **not** the library list |
| **Slot** | Physical lobby `idle` / `allocated` / `live` | `allocate` / `apply-config` / `start` |

Convex remains: auth, presets, laps/battles. **Not** mod catalog SoT. **Not** `live_players` for Host dashboards after cutover.

---

## 2. Env (server only — Vercel / `.env.local`)

```bash
CONTROL_API_URL=https://hub.example.com
CONVEX_WORKER_SECRET=…   # same as hub X-Worker-Secret; NEVER NEXT_PUBLIC_
```

Browser calls **only** `/api/control/*`. DevTools must never show the hub hostname.

---

## 3. BFF to implement

1. `src/lib/controlApi/server.ts` — Clerk `requireUser` + `controlGet` / `controlPost` (header `X-Worker-Secret`, base `CONTROL_API_URL`).
2. Route Handlers under `app/api/control/...` that mirror hub `/v1/...`.

| Host need | BFF → hub |
|-----------|-----------|
| Mod catalog | `GET /v1/mods?kind=car\|track` |
| Detail + versions | `GET /v1/mods/:slug` |
| VPS badges | `GET /v1/mods/availability?instanceId=` |
| Prefetch | `POST /v1/instances/:id/mods/ensure` |
| Free slots | `GET /v1/servers?region=&status=idle` |
| Reserve | `POST /v1/servers/allocate` `{ "region", "presetRef?" }` |
| Config | `POST /v1/servers/:slotId/apply-config` |
| Lifecycle | `POST .../start\|stop\|restart` |
| Live roster | `GET /v1/servers/:lobbyName/live?instanceId=` |
| Live summary | `GET /v1/live/summary` |
| Skins / layouts (when LOCAL) | `GET /v1/instances/:id/mods/cars\|tracks` — join by `acContentSlug`. Also returned on `GET /v1/mods/availability` items when `local=LOCAL` (`skins[]` / `configs[]`). Fleet edge id (`eu`) and `AC_INSTANCE_ID` (`vps-eu-2`) both resolve. |

Client hooks: `fetch('/api/control/…')` — catalog ~60s; availability ~5–15s while downloading; inventory after ensure LOCAL; live ~5s.

---

## 4. Mods UI (required)

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
allocate
  → ensure cars/tracks
  → wait LOCAL
  → GET inventory (fresh skins/configs)
  → UI or preset picks skin + layout
  → apply-config
  → start
```

Do not put a skin/layout in apply-config that is missing from inventory.

### D. Do not

- Use inventory alone as the library list.
- Assume skins from the ZIP without inventory.
- Invent layouts if `configs` is empty (default layout only).

---

## 5. Server flow (Host UX)

```text
User picks region + preset (Convex)
        ↓
POST /v1/servers/allocate  { region, presetRef }
        ↓
Resolve cars/track from preset (slugs; version if present)
        ↓
POST /v1/instances/{instanceId}/mods/ensure
        ↓
Poll availability / ensure until LOCAL  (ERROR → do not start)
        ↓
GET inventory → skins / layouts for LOCAL mods
        ↓
POST /v1/servers/{slotId}/apply-config
        ↓
POST /v1/servers/{slotId}/start
```

Notes:

- Hub also runs ensure+wait on apply/start (safety net). Host should still call ensure explicitly for progress UX.
- **Never** start AC if required mods are not LOCAL.
- **Never** depend on Hub/S3/R2 during a race — content must already be on the VPS.
- Live path uses **lobby name** (e.g. `ProjectD`), not Convex `servers._id`. Map `_id` → lobby + `instanceId` (`AC_INSTANCE_ID`).

More detail: [SERVER_PLATFORM.md](../SERVER_PLATFORM.md).

---

## 6. Acceptance checklist

1. Browser only hits `/api/control/*`.
2. Picker shows central catalog + per-VPS badges; thumbs when `imageUrl` is set.
3. When a mod is LOCAL, Host shows skins (cars) / layouts `configs` (tracks) from inventory joined by `acContentSlug`; not before LOCAL.
4. Ensure on MISSING → DOWNLOADING → LOCAL; spamming ensure does not create duplicate jobs.
5. Allocate → ensure → inventory → apply-config → start works on an idle slot.
6. Start with missing/ERROR mod does not leave the server racing.
7. Live roster uses lobby name + `instanceId`.
8. Hub smoke curls ([PROJECTD_BFF_INSTALL.md](./PROJECTD_BFF_INSTALL.md)) OK before UI work.

After Host no longer needs Convex `live_players`: ops sets `LIVE_INGEST_CONVEX=false` on every edge ([CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md)).

---

## 7. Cursor prompt (paste into ProjectD)

```text
Implement the Next.js BFF `/api/control/*` + Host UI per assetto-infra
docs/examples/PROJECTD_HOST_TEAM_HANDOFF.md:

- Central library GET /v1/mods (+ /:slug) with optional imageUrl
- Availability GET /v1/mods/availability?instanceId=
- Ensure POST /v1/instances/:id/mods/ensure (idempotent)
- When LOCAL: GET inventory cars|tracks for skins[] / configs[] joined by acContentSlug
- Server flow: region+preset → allocate → ensure → inventory → apply-config → start
- Live by lobby name + instanceId (not Convex servers._id)
- Do NOT build the mod library from per-VPS inventory
- Do NOT invent skins/layouts; only show them after LOCAL from inventory
- Do NOT put CONVEX_WORKER_SECRET in the browser / NEXT_PUBLIC_
- Clerk requireUser on BFF; proxy to CONTROL_API_URL with X-Worker-Secret

Contracts: CONTROL_API_V1.md, SERVER_PLATFORM.md, openapi/control-api-v1.yaml
```

---

## 8. Smoke (hub reachable)

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

curl -sS "$HUB/v1/mods" -H "X-Worker-Secret: $SECRET" | head -c 400
curl -sS "$HUB/v1/mods/availability?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET" | head -c 400
curl -sS "$HUB/v1/servers?region=eu&status=idle" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"
```
