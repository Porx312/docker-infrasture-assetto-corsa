# Mod repository and distribution

Hub (`ac-data-backend`) owns the **central mod library** in **PostgreSQL** + **object storage** (local / S3 / R2). Each game VPS keeps only a **local cache** under `CONTENT_PATH`. The mod agent **distributes** (materializes) central artifacts into that cache. Host reads the **central catalog** and **per-VPS availability** — not a library built from each VPS.

## Architecture

```text
                    CENTRAL MOD LIBRARY
                  Postgres + Object Storage
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
           ProjectD      VPS 1        VPS 2
             Web        local cache   local cache
                           │            │
                           ▼            ▼
                          AC           AC
```

| Concept | Source of truth | Notes |
|---------|-----------------|-------|
| **Central Library** | Hub Postgres (`mod_packages`, `mod_artifacts`) + object storage | mods, cars, tracks, versions, artifacts, metadata, SHA256, storage location, optional cover image |
| **Local Cache** | VPS `CONTENT_PATH` + content-addressed blobs | what is physically materialized on that VPS |
| **Inventory** | Edge disk scan → Redis; hub `edge_artifact_inventory` | **observed** local state — not a catalog |
| **Distribution** | `sync_jobs` + mod agent | central artifact → local cache |

**Do not** create a library per VPS. **Do not** duplicate `mod_packages` / `mod_artifacts` per edge. **Do not** treat `edge_artifact_inventory` or Redis scan as the global library.

## Control API (Host)

| Method | Path | Role |
|--------|------|------|
| `GET` | `/v1/mods` | Central library list |
| `GET` | `/v1/mods/:slug` | One package + versions |
| `GET` | `/v1/mods/availability?instanceId=` | Central + local inventory + active jobs |
| `POST` | `/v1/instances/:id/mods/ensure` | Idempotent materialize (reuse active job) |
| `GET` | `/v1/instances/:id/mods/cars\|tracks` | **Legacy LOCAL CONTENT / INVENTORY** (Redis scan) — keep during cutover |

**Preview image (one per package):** Admin uploads via `POST /admin/mods/:packageId/preview-image` → hub disk (`MOD_PREVIEW_IMAGES_PATH` or `data/mod-previews`) → public `GET /mods/images/:filename`. Catalog exposes `imageUrl`. Edges do **not** need the image to run AC.

Host UI must combine central catalog + availability badges (`LOCAL` / `MISSING` / `DOWNLOADING` / `INSTALLING` / `ERROR`). Never: selected VPS → GET inventory → build library.

Exact version identity: `artifactId` + `sha256` (+ `version` when present). Slug alone is not enough for “LOCAL”.

## Environment (hub)

```bash
DATABASE_URL=postgres://user:pass@host:5432/acdata
MOD_UPLOAD_ROOT=/var/lib/ac-data/mod-uploads
MOD_STORAGE_MODE=local          # or s3
MOD_MASTER_LOCAL_PATH=/var/lib/ac-data/mod-uploads/master
MOD_HUB_PUBLIC_URL=https://hub.example.com   # local mode artifact downloads

# S3-compatible (R2/B2)
MOD_S3_BUCKET=ac-mods
MOD_S3_ACCESS_KEY_ID=
MOD_S3_SECRET_ACCESS_KEY=
MOD_S3_ENDPOINT=https://....r2.cloudflarestorage.com
MOD_S3_REGION=auto

REDIS_HOST=127.0.0.1
# Key = EDGE_ID; instanceId = AC_INSTANCE_ID on that VPS
FLEET_EDGE_REGISTRY={"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2"}}

# Optional: wait for ensure before slot start
MOD_ENSURE_WAIT_MS=120000
MOD_ENSURE_POLL_MS=2000

# Optional cover images for central library (default: data/mod-previews or sibling of CONTENT_PATH)
# MOD_PREVIEW_IMAGES_PATH=/var/lib/ac-data/mod-previews
# Needs same public base URL as branding: HUD_PUBLIC_BASE_URL / PUBLIC_API_BASE_URL / MOD_HUB_PUBLIC_URL
```

Migrations run automatically on hub startup (`migrations/001_mod_repository.sql`, `002_…`, `003_…`).

## Environment (edge VPS)

```bash
MOD_AGENT_ENABLED=true
EDGE_ID=eu                      # must match FLEET_EDGE_REGISTRY key
AC_INSTANCE_ID=vps-eu-2         # must match registry instanceId
BACKEND_WORKER_URL=https://hub.example.com
CONVEX_WORKER_SECRET=...        # same as hub (X-Worker-Secret)
AC_MOD_ROOT=/var/lib/ac-mods
CONTENT_PATH=/var/lib/ac-mods/pool
```

Symlink each AC instance: `server/content/cars` → `$CONTENT_PATH/cars` (shared pool — one materialization per VPS, many servers).

## Start flow

```text
allocate → resolve preset → resolve required mods → ensure → wait LOCAL → apply-config → start AC
```

Assetto Corsa must never depend on Hub / S3 / R2 / internet during a race. Prefetch only; never download mods while the server is running a session.

## Admin UI

Tab **Mod distribution**:

- Upload ZIP → finalize → distribute to selected or all VPS.
- **Edges health**: `last_seen` from agent heartbeat — if stale and status stays `PENDING`, enable `MOD_AGENT_ENABLED` / check `EDGE_ID`.
- Status badges: `PENDING` (queued / waiting agent), `SYNCING`, `READY`, `ERROR`.

Server modal **Overview**: required mods readiness + **Sync missing mods**.

## PENDING forever?

Usually: agent not running, wrong `EDGE_ID`, hub unreachable (`BACKEND_WORKER_URL`), or a typo in the URL (e.g. `ttps://` instead of `https://`). Check edge logs for `[mod-agent]` and hub **Edges** strip on the Mod distribution tab.

## Slow with many mods?

The agent processes jobs **sequentially** but **drains the queue** in one tick (up to `MOD_AGENT_DRAIN_MAX`, default 10) instead of waiting `MOD_AGENT_POLL_MS` between every ZIP. Defaults: `MOD_AGENT_POLL_MS=1500`. After the first successful install, cache-hit by SHA skips re-download.

Also ensure `MOD_HUB_PUBLIC_URL` is the **hub** public HTTPS URL (artifact download), not the edge game port.

## API

- Control API (worker secret): `/v1/mods`, `/v1/mods/availability`, `/v1/instances/:id/mods/ensure`
- Admin (cookie auth): `/admin/mods/*`, `/admin/servers/:name/mods/*`
- Agent (worker secret + `X-Edge-Id`): `/api/mod-agent/v1/*`

## Garbage collection

**Not aggressive.** Do not delete local content from `last_seen` alone. Before remove, know active server references. Model room for `last_used_at` / `pinned` later — GC is out of scope for the central-library cutover.

`GET /admin/mods/gc/candidates` lists READY artifacts with **zero** server references on an edge. `POST /admin/mods/gc/run` schedules remove jobs (ops only).

## Storage

`objectStorage.ts` abstracts `local` | `S3` | `R2`. Edge receives a signed/download URL — it does not know the provider. Blobs are content-addressed: `artifacts/sha256/...` / edge `blobs/sha256/...`.

## Global SHA uniqueness

DB currently uses `UNIQUE(package_id, sha256)`. Global dedupe across packages is a future safe migration — do not block central catalog / availability / ensure on it.

## Legacy fleet rsync

`CONTENT_FLEET_SYNC_ENABLED` full-directory rsync is **deprecated**; use artifact-based distribution instead.
