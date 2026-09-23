# Backend hub (standalone deploy)

This folder is the **smallest install** for a VPS that only runs `@projectd/ac-data-backend` (Convex ingest, HUD gateway, admin). You do **not** need telemetry, edge, or `server/` on this machine.

## Build the tarball (on a machine that has full `assetto-infra`)

```bash
./scripts/package-backend-hub.sh
```

Upload `dist/ac-data-backend-hub.tar.gz` to your backend VPS.

## On the backend VPS

```bash
mkdir -p ~/ac-data-backend-hub && cd ~/ac-data-backend-hub
tar xzf ac-data-backend-hub.tar.gz   # contents: package.json + packages/{shared,backend}
cp packages/ac-data-backend/.env.example .env.production
# edit .env.production (Convex, ADMIN_*, HUD_EDGE_REGISTRY, …)

npm install
npm run build
export ASSETTO_ENV_FILE=$PWD/.env.production
npm start
```

**Dev (watch):** run from the **hub root** (`ac-data-backend-hub/`), not `packages/ac-data-backend/` alone:

```bash
npm install
npm run dev
```

The first run compiles `@projectd/ac-data-shared` to `dist/` (required — imports use `dist/config/loadEnv.js`). If you see `ERR_MODULE_NOT_FOUND` for `@projectd/ac-data-shared/dist/...`, run `npm run build -w @projectd/ac-data-shared` once, then `npm run dev` again.

Copy env to hub root (backend reads via shared `loadEnv`):

```bash
cp packages/ac-data-backend/.env.example .env.local
# Windows: set ASSETTO_ENV_FILE=C:\path\to\ac-data-backend-hub\.env.local
```

Use **systemd** or **pm2** with `ASSETTO_ENV_FILE` pointing at your env file.

## Central admin UI

Open `https://YOUR_HUB/admin/login` — the dashboard includes **Content**, **Servers**, **Activity**, and **HUD** tabs.

Configure fleet edges on the hub (private URLs reachable from the hub):

```env
FLEET_EDGE_REGISTRY={"eu":{"label":"EU VPS","baseUrl":"http://10.0.0.2:3000","instanceId":"vps-eu-2"}}
CONVEX_DEPLOYMENT_URL=…
CONVEX_PRODUCT_KEY=…
CONVEX_INGEST_SECRET=…
CONVEX_WORKER_SECRET=…
```

HUD lobby routing: edges auto-register lobbies via `POST /hud/registry/sync` (Redis on hub). Optional `HUD_EDGE_REGISTRY` override. Set `HUD_PUBLIC_BASE_URL` for bootstrap WSS fallback.

Or omit `FLEET_EDGE_REGISTRY` and use deduped `HUD_EDGE_REGISTRY` base URLs (legacy).

- **Activity**: merged feed from all VPS (badge per row).
- **Other tabs**: choose **VPS** in the header, then edit that edge’s content/branding/servers.

Edges must run `@projectd/ac-data-edge` with `/admin` API enabled (default: hub-only via `X-Worker-Secret`, not public).

## What edges need from you

On each **game VPS** (edge), set (hub-centric — no Convex SDK keys on edge):

```bash
BACKEND_INGEST_URL=https://THIS_HUB_HOSTNAME
REDIS_CONFIG_SYNC_ON_EDGE=false
CONVEX_WORKER_SECRET=...  # same as hub (X-Worker-Secret only)
EDGE_REGISTRY_BASE_URL=http://PRIVATE_IP:3000
EDGE_PUBLIC_BASE_URL=https://REGIONAL_PUBLIC_HOST
```

Convex webhooks `refresh-user` / `refresh-config` should target **this hub** (`POST /hud/worker/refresh-user` with `instanceId`). The hub forwards to the matching edge in `FLEET_EDGE_REGISTRY`.

See [docs/MULTI_REGION_EDGE.md](../../docs/MULTI_REGION_EDGE.md).
