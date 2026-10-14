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
| **Copy A→B** | Target pulls `GET /api/mod-agent/v1/trees/:kind/:slug` | tar stream; no ZIP left on disk |
| **Upload from PC** | Temp ZIP → materialize → delete ZIP | registers as `edge_folder` |

**Identity:** `kind + slug + contentHash` (deterministic tree hash of relative paths + sizes + file digests). Sidecar `.acmod.json`: `{ artifactId, contentHash, kind, slug }`.

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
```

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

### Upload ZIP from admin

1. Admin → Cars/Tracks → pick VPS → ZIP → Upload.
2. Hub proxies to edge `POST /admin/mods/local-upload` (temp only).
3. Edge materializes into `CONTENT_PATH`, hashes folder, registers `edge_folder`, **deletes the temp ZIP** (no permanent blob).

### Copy VPS A → VPS B

1. Side panel → select targets → **Sync / copy to selected**.
2. Hub enqueues install on B; at acquire time sets `treeDownloadUrl` to A’s tree URL.
3. B pulls tar with `X-Worker-Secret`, extracts atomically into `CONTENT_PATH`, reports READY.

### Delete on one VPS

Cars/Tracks → **Remove from VPS** or **Delete folder on this VPS**. Catalog row remains until package delete.

### GC leftover ZIP blobs

After migrating to folder-first:

```http
POST /admin/mods/edges/:edgeId/gc-blobs
```

Deletes files under `$AC_MOD_ROOT/blobs` on that edge (one-shot reclaim of disk).

## Start flow

```text
allocate → resolve preset → resolve required mods → ensure → wait LOCAL → apply-config → start AC
```

AC must not depend on hub / peer download mid-session. Prefetch only.

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
| Admin | `/admin/mods/*`, `…/edges/:id/inventory`, `…/upload`, `…/adopt`, `…/gc-blobs` |
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
