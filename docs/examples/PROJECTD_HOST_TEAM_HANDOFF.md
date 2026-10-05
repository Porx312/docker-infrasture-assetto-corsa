# ProjectD Host — team handoff (servers + mods)

**Where to implement:** ProjectD repo (Next.js Host), **not** `assetto-infra`.  
**Hub contracts:** [CONTROL_API_V1.md](../CONTROL_API_V1.md), [SERVER_PLATFORM.md](../SERVER_PLATFORM.md), [MOD_DISTRIBUTION.md](../MOD_DISTRIBUTION.md), [CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md), OpenAPI [openapi/control-api-v1.yaml](../openapi/control-api-v1.yaml), short install [PROJECTD_BFF_INSTALL.md](./PROJECTD_BFF_INSTALL.md).

Paste this file (or the Cursor prompt in §7) into a ProjectD chat. Do not implement Host UI inside assetto-infra.

**Start here (MVP):** [PROJECTD_WEB_CONVEX_HUB_HANDOFF.md](./PROJECTD_WEB_CONVEX_HUB_HANDOFF.md) — Convex workers + Redis start; hub ≈ **live** players; `CONTROL_API_HOST_OPS` **off** (no allocate).  
**Catalog sync hub→Convex:** [HOST_CATALOG_SYNC.md](../HOST_CATALOG_SYNC.md).  
This longer doc is **phase 2 / ops only** (hub mod ensure / inventory + allocate when `CONTROL_API_HOST_OPS` is on).

---

## 1. Mental model (one sentence)

> **MVP:** Convex owns product catalog + start (Redis desired-config); hub owns **live roster** (and ZIP ensure when disk is empty).  
> **Phase 2** (`CONTROL_API_HOST_OPS`): hub can also own idle pool allocate + central mod library UI — see sections below.

```text
MVP:
  Host UI → Convex (catalog/start) + /api/control (live only)
Phase 2 (+ CONTROL_API_HOST_OPS):
  Host UI → /api/control → Hub /v1 (mods ensure, allocate, …)
```

| Concept | What it is | Host reads/writes |
|---------|------------|-------------------|
| **Product catalog (MVP)** | Convex `battle_cars` / `battle_tracks` / `servers` | Convex queries + workers |
| **Central ZIP library (ops / phase 2)** | Hub Postgres `mod_packages` + artifacts | `GET /v1/mods` when ops flag on |
| **Local cache** | Materialized content on that VPS | via `availability` / `ensure` |
| **Inventory** | Disk observation (Redis scan) | skins / layouts when LOCAL — **not** the library list |
| **Slot (phase 2)** | Physical lobby `idle` / `allocated` / `live` in hub Postgres | Only if `CONTROL_API_HOST_OPS=true`: `allocate` / `apply-config` / `start` |
| **MVP start** | Convex `servers` + Redis desired-config | See [PROJECTD_WEB_CONVEX_HUB_HANDOFF.md](./PROJECTD_WEB_CONVEX_HUB_HANDOFF.md) — **no** allocate |

Convex remains: auth, presets, laps/battles. **Not** `live_players` for Host dashboards after cutover (`LIVE_INGEST_CONVEX=false`).

---

## 2. Env (server only — Vercel / `.env.local`)

```bash
CONTROL_API_URL=https://hub.example.com
CONVEX_WORKER_SECRET=…   # same as hub X-Worker-Secret; NEVER NEXT_PUBLIC_
# CONTROL_API_HOST_OPS=true   # phase 2 only — allocate / hub mod catalog as Host SoT
```

Browser calls Convex (catalog/auth/start MVP) and **`/api/control/*`** for hub live (and phase-2 ops). DevTools must never show the hub hostname or worker secret.

---

## 3. BFF to implement

**MVP:** live (+ optional ensure). **Phase 2** (`CONTROL_API_HOST_OPS`): also mods catalog / allocate / hub lifecycle.

1. `src/lib/controlApi/server.ts` — Clerk `requireUser` + `controlGet` / `controlPost` (header `X-Worker-Secret`, base `CONTROL_API_URL`).
2. Route Handlers under `app/api/control/...` that mirror hub `/v1/...`.

| Host need | BFF → hub | When |
|-----------|-----------|------|
| Live roster | `GET /v1/servers/:lobbyName/live?instanceId=` | MVP |
| Live summary | `GET /v1/live/summary` | MVP |
| Share / join link | Same live responses → `joinUrl` (acstuff `ip` + `httpPort`) | MVP |
| Mod catalog | `GET /v1/mods?kind=car\|track` | Phase 2 / ops |
| Detail + versions | `GET /v1/mods/:slug` | Phase 2 / ops |
| VPS badges | `GET /v1/mods/availability?instanceId=` | Phase 2 / ops |
| Prefetch | `POST /v1/instances/:id/mods/ensure` | Ops / phase 2 |
| Free slots | `GET /v1/servers?region=&status=idle` | Phase 2 |
| Reserve | `POST /v1/servers/allocate` | Phase 2 |
| Config / lifecycle | `POST /v1/servers/:slotId/apply-config`, `…/start\|stop` | Phase 2 hub path |
| Skins / layouts (when LOCAL) | `GET /v1/instances/:id/mods/cars\|tracks` | Ops / phase 2 |

Client: Convex for MVP catalog/start; `fetch('/api/control/…')` for live ~5s (and phase-2 mods/allocate when flagged).

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
5. **MVP:** start via Convex + Redis (no allocate). **Phase 2** (`CONTROL_API_HOST_OPS`): allocate → ensure → inventory → apply-config → start on an idle slot.
6. Start with missing/ERROR mod does not leave the server racing (when using hub ensure).
7. Live roster uses lobby name + `instanceId` (hub BFF) — not Convex presence loop.
8. Hub smoke curls ([PROJECTD_BFF_INSTALL.md](./PROJECTD_BFF_INSTALL.md)) OK for **live** before UI work; idle/allocate curls only if phase 2.

After Host no longer needs Convex `live_players`: ops sets `LIVE_INGEST_CONVEX=false` on every edge ([CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md)).

---

## 7. Cursor prompt (paste into ProjectD)

```text
Implement Host per assetto-infra docs/examples/PROJECTD_WEB_CONVEX_HUB_HANDOFF.md (MVP):

- Catalog cars/tracks/servers = Convex (workerUpsert* / queries) — NOT GET /v1/mods as Host library
- Start = startHostSession → setPhysicalServerActive → Redis desired-config (NO allocate unless CONTROL_API_HOST_OPS)
- Live = BFF GET /api/control/live/summary and /servers/:lobby/live?instanceId= (lobby name, not servers._id)
- Do NOT flood Convex with connected-user presence (LIVE_INGEST_CONVEX=false on edge after cutover)
- Optional ops: hub ensure ZIP when VPS missing content — see PROJECTD_HOST_TEAM_HANDOFF.md
- Do NOT put CONVEX_WORKER_SECRET in the browser / NEXT_PUBLIC_
- Clerk on BFF for live proxy to CONTROL_API_URL with X-Worker-Secret

Contracts: CONTROL_API_V1.md (live), SERVER_PLATFORM.md (MVP + phase 2)
```

---

## 8. Smoke (hub reachable)

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

# MVP — live
curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"
# Expect nullable joinUrl like https://acstuff.club/s/q:race/online/join?ip=…&httpPort=…

# Phase 2 / ops
# curl -sS "$HUB/v1/mods" -H "X-Worker-Secret: $SECRET" | head -c 400
# curl -sS "$HUB/v1/mods/availability?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET" | head -c 400
# curl -sS "$HUB/v1/servers?region=eu&status=idle" -H "X-Worker-Secret: $SECRET"
```
