# Mod repository and distribution

Hub (`ac-data-backend`) owns the mod catalog in **PostgreSQL**, stages uploads on disk, promotes blobs to **master storage** (local path or S3-compatible R2/B2), and orchestrates **per-VPS sync jobs**. Each game VPS runs the **mod agent** inside `ac-data-edge` (`MOD_AGENT_ENABLED=true`).

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

REDIS_HOST=127.0.0.1          # optional sync locks
FLEET_EDGE_REGISTRY={"eu":{"label":"EU","baseUrl":"http://10.0.0.2:3000"}}
```

Migrations run automatically on hub startup (`migrations/001_mod_repository.sql`).

## Environment (edge VPS)

```bash
MOD_AGENT_ENABLED=true
EDGE_ID=eu                      # must match fleet edge id
BACKEND_WORKER_URL=https://hub.example.com
CONVEX_WORKER_SECRET=...        # same as hub (X-Worker-Secret)
AC_MOD_ROOT=/var/lib/ac-mods
CONTENT_PATH=/var/lib/ac-mods/pool
```

Symlink each AC instance: `server/content/cars` → `$CONTENT_PATH/cars` (see `packages/ac-data-edge/README.md`).

## Admin UI

Tab **Mod distribution**: upload ZIP → finalize → distribute to selected or all VPS.

Server modal **Overview**: required mods readiness + **Sync missing mods**.

## API

- Admin (cookie auth): `/admin/mods/*`, `/admin/servers/:name/mods/*`
- Agent (worker secret + `X-Edge-Id`): `/api/mod-agent/v1/*`

## Garbage collection

`GET /admin/mods/gc/candidates` lists READY artifacts with **zero** server references on an edge. `POST /admin/mods/gc/run` schedules remove jobs.

## Legacy fleet rsync

`CONTENT_FLEET_SYNC_ENABLED` full-directory rsync is **deprecated**; use artifact-based distribution instead.
