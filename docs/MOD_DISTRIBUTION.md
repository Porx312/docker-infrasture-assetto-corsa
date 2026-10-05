# Mod repository and distribution

**Preferred model (edge-only blobs):** ZIP bytes live on game VPS nodes. The hub keeps **catalog metadata** only (`mod_packages`, `mod_artifacts`, inventory, sync jobs). Copy between VPS is **peer pull** (worker secret), not hub→edge re-upload.

Leftover hub master blobs (`storage_origin=hub`, `MOD_STORAGE_MODE`) are **read/delete only** — new uploads go **Fleet → VPS inventory → Upload to VPS**. There is no hub ZIP upload API.

## Architecture

```text
                         HUB (metadata)
                    Postgres + Redis inventory
                     sync_jobs / ensure API
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
           ProjectD      VPS 1  ←──→  VPS 2
             Web       CONTENT_PATH   CONTENT_PATH
                       + blob cache   + blob cache
                           │            │
                           ▼            ▼
                          AC           AC
```

| Concept | Source of truth | Notes |
|---------|-----------------|-------|
| **Catalog** | Hub Postgres | slug, kind, SHA256, `storage_key`, optional cover — **not** the ZIP |
| **Blob** | Edge `AC_MOD_ROOT/blobs` | `storage_key` = `edge:{edgeId}:{sha256}` when edge-owned |
| **Local pool** | VPS `CONTENT_PATH` | materialized cars/tracks for AC |
| **Inventory** | Edge scan → Redis; hub `edge_artifact_inventory` | observed READY / PENDING / ERROR |
| **Copy A→B** | Target agent pulls `/api/mod-agent/v1/blobs/:sha256` from source VPS | hub never stores the ZIP |

**Do not** treat Redis scan as the global library. **Do not** accumulate master ZIPs on the hub for new mods.

## Risks (edge-only)

- **Single copy:** if the only READY VPS loses the blob, re-upload is required (`artifact_blob_missing`).
- **Peer reachability:** VPS must reach each other via `FLEET_EDGE_REGISTRY.baseUrl` (and share `CONVEX_WORKER_SECRET`).
- **No hub fallback:** ensure/distribute cannot invent bytes that no edge has.

## Control API (Host)

| Method | Path | Role |
|--------|------|------|
| `GET` | `/v1/mods` | Central catalog list |
| `GET` | `/v1/mods/:slug` | One package + versions |
| `GET` | `/v1/mods/availability?instanceId=` | Catalog + local inventory + active jobs |
| `POST` | `/v1/instances/:id/mods/ensure` | Idempotent materialize (reuse active job) |
| `GET` | `/v1/instances/:id/mods/cars\|tracks` | LOCAL CONTENT / INVENTORY (Redis scan) |

Exact version identity: `artifactId` + `sha256`. Slug alone is not enough for “LOCAL”.

## Environment (hub)

```bash
DATABASE_URL=postgres://user:pass@host:5432/acdata
REDIS_HOST=127.0.0.1
# Key = EDGE_ID; instanceId = AC_INSTANCE_ID on that VPS
FLEET_EDGE_REGISTRY={"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2","joinIp":"1.2.3.4"}}

CONVEX_WORKER_SECRET=...   # same as edges (admin proxy + agent + peer blob pull)

# Optional legacy hub master (older uploads only)
# MOD_UPLOAD_ROOT=/var/lib/ac-data/mod-uploads
# MOD_STORAGE_MODE=local
# MOD_HUB_PUBLIC_URL=https://hub.example.com

# Optional cover images (metadata only)
# MOD_PREVIEW_IMAGES_PATH=/var/lib/ac-data/mod-previews
```

Migrations run on hub startup (`migrations/001_…` … `008_mod_artifact_edge_origin.sql`).

## Environment (edge VPS)

```bash
MOD_AGENT_ENABLED=true
EDGE_ID=eu
AC_INSTANCE_ID=vps-eu-2
BACKEND_WORKER_URL=https://hub.example.com
CONVEX_WORKER_SECRET=...
AC_MOD_ROOT=/var/lib/ac-mods
CONTENT_PATH=/var/lib/ac-mods/pool
```

Symlink each AC instance: `server/content/cars` → `$CONTENT_PATH/cars` (shared pool).

## Flows

### Upload to one VPS

1. Admin → **Fleet** → pick edge → ZIP → **Upload to VPS**.
2. Hub proxies multipart to edge `POST /admin/mods/local-upload` (temp only on hub).
3. Edge caches blob, materializes pool, calls hub `register-local`.
4. Hub inserts catalog row with `storage_origin=edge`, marks that edge READY.

### Copy VPS A → VPS B

1. Cars/Tracks side panel → select target edges → **Sync / copy to selected**.
2. Hub enqueues install on B; at acquire time sets `downloadUrl` to A’s blob URL.
3. B pulls with `X-Worker-Secret`, materializes, reports READY.

Explicit API: use `POST /admin/mods/artifacts/:id/distribute` with target edge ids (edge-owned artifacts peer-pull automatically).

### Delete on one VPS

Cars/Tracks → select edges → **Remove from VPS** → `remove` sync jobs (pool + blob on that edge). Catalog row remains until package delete.

## Start flow

```text
allocate → resolve preset → resolve required mods → ensure → wait LOCAL → apply-config → start AC
```

AC must not depend on hub / peer download mid-session. Prefetch only.

## Admin UI

- **Fleet:** per-VPS inventory, upload-to-edge, agent health, capacity, stuck syncs, GC.
- **Cars / Tracks:** catalog metadata + distribution matrix (sync / verify / remove).
- Server modal **Overview:** required mods readiness + sync missing.

## PENDING forever?

Usually: agent off, wrong `EDGE_ID`, hub unreachable (`BACKEND_WORKER_URL`), or peer `baseUrl` unreachable for edge-owned copy. Check `[mod-agent]` logs and Fleet edges strip.

## API cheat sheet

| Surface | Paths |
|---------|--------|
| Control (worker) | `/v1/mods`, `/v1/mods/availability`, `/v1/instances/:id/mods/ensure` |
| Admin | `/admin/mods/*`, `/admin/mods/edges/:id/inventory`, `/admin/mods/edges/:id/upload` |
| Agent | `/api/mod-agent/v1/*` including `register-local` |
| Peer blob | `GET /api/mod-agent/v1/blobs/:sha256` on source edge |

## Garbage collection

Not aggressive. `GET /admin/mods/gc/candidates` / `POST /admin/mods/gc/run` schedule removes for READY artifacts with zero server refs.

## Leftover hub masters

Older `storage_origin=hub` artifacts may still download from hub disk/S3 until re-uploaded on an edge. No new hub ZIP writes. No CONTENT_FLEET_SYNC rsync.