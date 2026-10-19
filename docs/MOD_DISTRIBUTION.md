# Mod repository and distribution (folder-first)

**Source of truth:** folders under each VPS `CONTENT_PATH/cars` and `CONTENT_PATH/tracks` (what Assetto Corsa loads).

The hub keeps **catalog metadata only** (`mod_packages`, `mod_artifacts`, inventory, sync jobs). There are **no permanent ZIP blobs** for new mods. Peer copy between VPS is a **tar stream** of the content folder (ephemeral), not a stored ZIP.

Unified catalog only: cars/tracks share `mod_packages`. Migration `009_drop_unused_mod_split.sql` drops abandoned split tables. Migration `011_mod_artifact_edge_folder.sql` adds `storage_origin=edge_folder`.

## Architecture

```text
                         HUB (metadata index)
                    Postgres + Redis inventory
                     sync_jobs / ensure API
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
           ProjectD      VPS 1  ←──→  VPS 2
             Web       CONTENT_PATH   CONTENT_PATH
                       (folder SoT)   (folder SoT)
                           │            │
                           ▼            ▼
                          AC           AC
```

| Concept | Source of truth | Notes |
|---------|-----------------|-------|
| **Installed content** | VPS `CONTENT_PATH` | cars/tracks folders for AC |
| **Syncable** | Folder **Adopt**ed (or uploaded once) | hub row + `.acmod.json` + `contentHash` |
| **Catalog** | Hub Postgres | slug, kind, `contentHash` as `sha256`, `storage_key` |
| **Copy A→B** | Target pulls `GET /api/mod-agent/v1/trees/:kind/:slug` | **server-slim** tar (Pack subset); no ZIP left on disk |
| **Upload from PC** | Browser filters slim → plan/put/commit (incremental) | registers as `edge_folder` only |

**Identity:** `kind + slug + contentHash` where `contentHash` is the **server-slim** tree (Content Manager Pack–style: `data.acd` / track `surfaces.ini` + small UI stubs — not kn5/dds). Sidecar `.acmod.json`: `{ artifactId, contentHash, kind, slug }`.

### Server-slim (Pack)

`acServer` only needs checksum/physics files. Upload and peer sync merge those files into `CONTENT_PATH` **without deleting** other client assets if the pool is a full game install. Preferred upload: Content Manager **Pack** (server files only). Full client mods stay with players (CM Download URL / elsewhere) — not hosted by the hub.

**Do not** accumulate master ZIPs on the hub. Permanent `AC_MOD_ROOT/blobs` and `/blobs/:sha256` were removed; installs use S3 tar.gz (or emergency peer tree).

## Pool layout (per VPS)

```bash
CONTENT_PATH=/path/to/pool          # shared pool
# symlink each AC server instance:
#   server/<name>/content/cars   → $CONTENT_PATH/cars
#   server/<name>/content/tracks → $CONTENT_PATH/tracks
```

One pool per VPS; instances share via symlinks (already the recommended setup).

## Control API (Host)

| Method | Path | Role |
|--------|------|------|
| `GET` | `/v1/mods` | Central catalog list |
| `GET` | `/v1/mods/:slug` | One package + versions |
| `GET` | `/v1/mods/availability?instanceId=` | Catalog + local inventory + active jobs |
| `POST` | `/v1/instances/:id/mods/ensure` | Idempotent materialize (reuse active job) |
| `GET` | `/v1/instances/:id/mods/cars\|tracks` | LOCAL CONTENT / INVENTORY (Redis scan) |

Exact version identity: `artifactId` + `contentHash` (`sha256` column). Slug alone is not enough for “LOCAL”.

## Environment (hub)

```bash
DATABASE_URL=postgres://user:pass@host:5432/acdata
REDIS_HOST=127.0.0.1
FLEET_EDGE_REGISTRY={"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2","joinIp":"1.2.3.4"}}

CONVEX_WORKER_SECRET=...   # same as edges (admin proxy + agent + peer tree pull)

# Optional cover images (metadata only)
# MOD_PREVIEW_IMAGES_PATH=/var/lib/ac-data/mod-previews

# --- Contabo / S3 canonical packs ---
# Bucket MUST stay private. Keys only on hub. Edges use hub-presigned GET.
# MOD_STORAGE_MODE=s3
# MOD_S3_BUCKET=projectd-mods-staging
# MOD_S3_ENDPOINT=https://eu2.contabostorage.com
# MOD_S3_REGION=eu2
# MOD_S3_ACCESS_KEY_ID=...
# MOD_S3_SECRET_ACCESS_KEY=...
# MOD_PRESIGN_TTL_SEC=3600
# MOD_S3_CANONICAL_UPLOAD=1   # after register-local, promote slim tar.gz → manifest.s3Key
# MOD_S3_PULL_ENABLED=1       # ensure/acquire: install from S3 when local cache miss
# MOD_PEER_PULL_ENABLED=0     # peer mesh OFF by default (set 1 only for emergency rollback)
# MOD_S3_PULL_TIMEOUT_MS=600000  # AbortSignal on Contabo GET (default 10m)
# MOD_AGENT_PROGRESS_MIN_MS=500  # throttle hub progress POSTs (also on each integer %)

# --- CSP min version (edge) ---
# AC_CSP_MIN_BUILD=2735   # default; TRACK=csp/2735/../<slug>. 0 / off = plain TRACK
# Builds: CSP 0.2.1 → 2735, CSP 0.2.11 → 3465 (see https://c1xtz.github.io/csp-logs/)
```

### Contabo S3 library + install on-demand

Recommended staging/prod:

`MOD_STORAGE_MODE=s3` + `MOD_S3_PULL_ENABLED=1` + `MOD_PEER_PULL_ENABLED=0`.

**Primary upload (admin):** `POST/PUT /mods/library/slim-upload/{plan,file,commit}` — hub packs server-slim `tar.gz` → Contabo → registers `storage_origin=s3_canonical` with validated `manifest_json.s3*` **without writing any VPS**. UI: **Upload to library (S3)**; catalog default view **Library (S3)**.

**Install when needed:** every start/restart path on the edge goes through `startServerWithMods` / `restartServerWithMods` (admin UI, Redis desired-config, provision, HTTP `/servers/:name/start`). The gate:

1. Resolves required track/cars from the instance INI.
2. If `MOD_AGENT_ENABLED=true`, asks the hub to `sync-missing` (enqueue S3 installs; jobs are idempotent — reuse `queued`/`running`).
3. Waits until each required slug exists under `CONTENT_PATH` (hub `READY` alone is not enough). Re-syncs periodically (`MOD_START_RESYNC_EVERY_MS`).
4. Times out with `409 MODS_NOT_READY` + `installErrors` / missing status (`MOD_START_INSTALL_TIMEOUT_MS`, default 5m).

If the agent is **off**, start is allowed only when all required folders are already on disk; otherwise `MODS_NOT_READY` (no silent start without mods).

Manual pre-warm: **Install on selected VPS from library (S3)**.

**VPS cache view:** optional admin tab to see what is already on disk; **Remove from selected VPS** clears cache only. **Delete from library** removes catalog + S3 object.

**Legacy:** edge slim-upload / adopt → `edge_folder` + optional `MOD_S3_CANONICAL_UPLOAD=1` promote still exist for rollback / linking folders already on a VPS.

1. Library upload → Contabo key `artifacts/sha256/…/….tar.gz` + DB `s3Key` / `s3Sha256` / `s3SizeBytes` / `s3Format`.
2. Install on a VPS: **local cache** → if miss and `s3Key` valid → **S3** presign (hash object → extract → verify tree `contentHash` → READY). Partial / `queued` / `running` never count as READY for start.
3. Peer tree/blob copy runs **only** if `MOD_PEER_PULL_ENABLED=1` (or as fallback when S3 presign fails and peer flag is on).
4. Rollback peer mesh: `MOD_PEER_PULL_ENABLED=1`. Disable S3 install: `MOD_S3_PULL_ENABLED=0`.

### Diagnose MODS_NOT_READY / stuck S3 install

| Check | Where |
|-------|--------|
| Hub flags | `MOD_STORAGE_MODE=s3`, `MOD_S3_PULL_ENABLED=1` |
| Edge agent | `MOD_AGENT_ENABLED=true` and log line `[mod-agent] …` (loop processing jobs) |
| Hub refresh response | `installErrors[]` (flag / missing s3Key / UNKNOWN_PACKAGE) |
| Jobs | `sync_jobs` state `queued`/`running`/`failed` for the edge |
| Disk | `CONTENT_PATH/cars|tracks/<slug>` must exist before start succeeds |

Migrations run on hub startup (`001` … `012_mod_artifact_s3_canonical.sql`).

## Environment (edge VPS)

```bash
MOD_AGENT_ENABLED=true          # required for S3-only install-on-start
EDGE_ID=eu
AC_INSTANCE_ID=vps-eu-2
BACKEND_WORKER_URL=https://hub.example.com
CONVEX_WORKER_SECRET=...
CONTENT_PATH=/path/to/assetto/.../content   # required SoT
# MOD_START_INSTALL_TIMEOUT_MS=300000
# MOD_START_INSTALL_POLL_MS=2500
# MOD_START_RESYNC_EVERY_MS=15000
# AC_MOD_ROOT — ignored (ZIP blob cache removed); unset if present
```

Symlink each AC instance: `server/content/cars` → `$CONTENT_PATH/cars` (shared pool). Confirm the edge process logs the mod-agent loop starting when `MOD_AGENT_ENABLED=true`.

## Flows

### Adopt existing folder (no ZIP)

1. Cars / Tracks → open a **Local only** card.
2. **Adopt / Link to catalog** → hub proxies `POST /admin/mods/edges/:edgeId/adopt`.
3. Edge hashes the tree, writes `.acmod.json`, calls `register-local` with `storage_origin=edge_folder`.
4. Sync to other VPS is enabled.

### Smart slim upload from admin (default)

1. Admin → Cars/Tracks → pick VPS → drop any car/track ZIP (full client or CM Pack).
2. Browser scans the ZIP with the same **server-slim** allowlist (`data.acd` / track surfaces + UI stubs), shows `200 MB → ~2 MB`, and hashes each slim file.
3. `POST /admin/mods/edges/:edgeId/slim-upload/plan` — edge returns `already_present`, or `needed[]` / `skip[]` vs existing `CONTENT_PATH` (+ staging resume).
4. Client `PUT …/slim-upload/file` only for `needed` (concurrency 3, retry/backoff). Hub streams each file to the edge (no 200 MB ZIP hop).
5. `POST …/slim-upload/commit` — edge verifies per-file sha256 + tree `contentHash`, merges into `CONTENT_PATH`, registers `edge_folder`.

`POST /admin/mods/edges/:edgeId/upload` and edge `/admin/mods/local-upload` were removed. New catalog writes must use `storage_origin=edge_folder` (`register-local` rejects `edge` / `hub`).

### Install on another VPS (from S3 library)

1. Side panel → select targets → **Install on selected VPS from library (S3)**.
2. Requires `manifest.s3Key` (after promote). Hub enqueues ensure/install; agent downloads tar.gz from Contabo, verifies object hash + tree `contentHash`, then READY.
3. Peer copy (`MOD_PEER_PULL_ENABLED=1`) remains available for emergency rollback only.

### Delete on one VPS

Cars/Tracks → **Remove from VPS** or **Delete folder on this VPS**. Catalog row remains until package delete.

### ZIP / hub-master cleanup (done)

Permanent ZIP blobs (`AC_MOD_ROOT/blobs`), peer `GET …/blobs/:sha256`, hub master download, and agent ZIP install branch were **removed**. New installs use Contabo S3 tar.gz (or emergency peer **tree** when `MOD_PEER_PULL_ENABLED=1`). Unset any leftover `AC_MOD_ROOT` in edge env.

## Start flow

```text
Convex start (desired-config) → edge apply → start AC
(optional ops) ensure → wait LOCAL before start if content may be missing
```

Host ops `/v1/servers` allocate/lifecycle **retired**. AC must not depend on hub / peer download mid-session. Prefetch only.

## Admin UI

- **Cars / Tracks:** inventory badges **Linked** / **Local only**; Adopt for orphans; Sync after link.
- **Fleet:** agent health, capacity, stuck syncs.
- Server modal **Overview:** required mods readiness + sync missing.

## PENDING forever?

Usually: agent off, wrong `EDGE_ID`, hub unreachable (`BACKEND_WORKER_URL`), or peer `baseUrl` unreachable for tree pull. Check `[mod-agent]` logs and Fleet edges strip.

## API cheat sheet

| Surface | Paths |
|---------|--------|
| Control (worker) | `/v1/mods`, `/v1/mods/availability`, `/v1/instances/:id/mods/ensure` |
| Admin | `/admin/mods/*`, `…/edges/:id/inventory`, `…/slim-upload/*`, `…/adopt` |
| Agent | `/api/mod-agent/v1/*` including `register-local` |
| Peer tree (emergency) | `GET /api/mod-agent/v1/trees/:kind/:slug` on source edge when `MOD_PEER_PULL_ENABLED=1` |

## Storage origins

| `storage_origin` | Meaning |
|------------------|---------|
| `s3_canonical` | Contabo library tar.gz (default for new library uploads) |
| `edge_folder` | Folder on a VPS CONTENT_PATH; `storage_key` = `edge-folder:{edgeId}:{kind}:{slug}:{contentHash}` |

Historical `edge` / `hub` ZIP rows are unsupported — re-upload to S3 library or re-adopt as `edge_folder`. No CONTENT_FLEET_SYNC rsync.
