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

**Do not** accumulate master ZIPs on the hub or permanent blobs under `AC_MOD_ROOT/blobs` for new artifacts. Legacy `storage_origin=edge` blob keys and `/blobs/:sha256` remain for old rows until GC.

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

# --- Contabo / S3 canonical packs (Phase 1, optional; default off) ---
# Bucket MUST stay private. Keys only on hub. Edges use hub-presigned GET.
# MOD_STORAGE_MODE=s3
# MOD_S3_BUCKET=projectd-mods-staging
# MOD_S3_ENDPOINT=https://eu2.contabostorage.com
# MOD_S3_REGION=eu2
# MOD_S3_ACCESS_KEY_ID=...
# MOD_S3_SECRET_ACCESS_KEY=...
# MOD_PRESIGN_TTL_SEC=3600
# MOD_S3_CANONICAL_UPLOAD=1   # after register-local, promote slim tar.gz to S3 → manifest.s3Key
# MOD_S3_PULL_ENABLED=1       # ensure/acquire: local → peer → S3 if no peer READY
```

### Contabo S3 (canonical) + local cache

When flags are on and `MOD_STORAGE_MODE=s3`:

1. Slim commit / adopt still writes `CONTENT_PATH` and registers `storage_origin=edge_folder` (unchanged).
2. Hub best-effort promotes a **server-slim tar.gz** to Contabo; on success sets `manifest_json.s3Key` / `s3Sha256` / `s3SizeBytes` / `s3Format` (never changes `storage_origin`). Promote failure does **not** break register.
3. Ensure on a cold VPS: verify local → peer tree → S3 presigned download (hash object bytes, extract, verify tree `contentHash`). Incomplete downloads never become READY.
4. Rollback: set `MOD_S3_CANONICAL_UPLOAD=0` and `MOD_S3_PULL_ENABLED=0` (peer-only again). No S3 lifecycle/GC in this phase.

Migrations run on hub startup (`001` … `011_mod_artifact_edge_folder.sql`).

## Environment (edge VPS)

```bash
MOD_AGENT_ENABLED=true
EDGE_ID=eu
AC_INSTANCE_ID=vps-eu-2
BACKEND_WORKER_URL=https://hub.example.com
CONVEX_WORKER_SECRET=...
CONTENT_PATH=/path/to/assetto/.../content   # required SoT
# AC_MOD_ROOT=…   # deprecated; only for leftover blobs + gc-blobs, then remove
```

Symlink each AC instance: `server/content/cars` → `$CONTENT_PATH/cars` (shared pool).

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

### Copy VPS A → VPS B

1. Side panel → select targets → **Sync / copy to selected**.
2. Hub enqueues install on B; at acquire time sets `treeDownloadUrl` to A’s tree URL.
3. B pulls tar with `X-Worker-Secret`, extracts atomically into `CONTENT_PATH`, reports READY.

### Delete on one VPS

Cars/Tracks → **Remove from VPS** or **Delete folder on this VPS**. Catalog row remains until package delete.

### GC leftover ZIP blobs (ops checklist)

Keep peer `GET /api/mod-agent/v1/blobs/:sha256` and `AC_MOD_ROOT` **until** this is done on every edge:

1. Audit hub DB: `SELECT storage_origin, count(*) FROM mod_artifacts GROUP BY 1;`
2. For any `edge` / `hub` rows: re-adopt or slim-reupload so they become `edge_folder`, or delete the package.
3. On each VPS: `POST /admin/mods/edges/:edgeId/gc-blobs` (deletes `$AC_MOD_ROOT/blobs`).
4. Unset `AC_MOD_ROOT` in that edge’s `.env.local`.
5. Future cleanup (separate PR): remove blob route, agent ZIP branch, hub master serve.

```http
POST /admin/mods/edges/:edgeId/gc-blobs
```

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
| Admin | `/admin/mods/*`, `…/edges/:id/inventory`, `…/slim-upload/*`, `…/adopt`, `…/gc-blobs` |
| Agent | `/api/mod-agent/v1/*` including `register-local` |
| Peer tree (preferred) | `GET /api/mod-agent/v1/trees/:kind/:slug` on source edge |
| Peer blob (legacy) | `GET /api/mod-agent/v1/blobs/:sha256` — deprecated for **new** artifacts |

## Storage origins

| `storage_origin` | Meaning |
|------------------|---------|
| `edge_folder` | Folder-first (default for new uploads/adopts). `storage_key` = `edge-folder:{edgeId}:{kind}:{slug}:{contentHash}` |
| `edge` | Legacy edge ZIP blob. Prefer tree pull when folder exists; blob URL fallback |
| `hub` | Leftover hub master — read/delete only |

## Leftover hub masters / edge blobs

Older hub or edge ZIP rows may still exist until re-adopted or GC’d. No new permanent ZIP writes. No CONTENT_FLEET_SYNC rsync.
