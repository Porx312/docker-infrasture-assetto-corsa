# ac-data — Architecture & Operations

Host-native Node.js control plane for Assetto Corsa. **Cannot run in Docker** (spawns 32-bit `acServer`).

## Subsystem map

```
┌─────────────────────────────────────────────────────────────────┐
│ ac-data (single Node process on VPS host)                       │
├─────────────────────────────────────────────────────────────────┤
│ index.ts          HTTP entry, starts background workers         │
│ routes/           /ac-server (API key), /hud, /admin            │
│ controller/       AC spawn/stop, admin handlers, activity       │
├─────────────────────────────────────────────────────────────────┤
│ redisConvexBridge   XREADGROUP ac:events → Convex ingest        │
│                     Convex config poll → XADD ac:config         │
│                     dispatches eventHandlers/* side effects     │
│ redisConfigApplier  XREADGROUP ac:config → INI + restart        │
│ serverPool          idle shutdown from server_status counts     │
├─────────────────────────────────────────────────────────────────┤
│ services/hud/*      Redis cache, SSE, Convex HUD queries        │
│ services/activity/* Admin timeline (XREVRANGE ac:events)        │
│ serverBranding      CM branding JSON + wrapper ports            │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
   telemetry-data         Redis streams         Convex cloud
   (XADD ac:events)      ac:events, ac:config
```

| Subsystem | Key files | Data flow |
|-----------|-----------|-----------|
| **AC lifecycle** | `controller/controller.ts` | spawn/stop/restart, write INI |
| **Events bridge** | `redisConvexBridge.ts`, `eventHandlers/*` | `ac:events` → Convex + HUD/pool side effects |
| **Config applier** | `redisConfigApplier.ts` | `ac:config` → server_cfg.ini → restart |
| **HUD** | `services/hud/*` (29 modules) | Redis cache + WSS push + Convex queries |
| **Admin** | `adminRoutes.ts`, `public/js/*` | JWT, content, branding, activity |
| **Activity** | `services/activity/*` | Read-only `XREVRANGE` on `ac:events` |

See also: [`AGENTS.md`](../AGENTS.md), [`telemetry-data/REDIS_CONTRACT.md`](../telemetry-data/REDIS_CONTRACT.md).

## Minimal environment variables

Env is loaded from repo root `.env.local` (dev) or `.env.production` (prod) via `ASSETTO_ENV_FILE`.

### Required (all deployments)

| Variable | Purpose |
|----------|---------|
| `SERVERS_PATH` | Path to `server/`, `server-1/`, … folders |
| `REDIS_HOST` | Redis for streams, HUD cache, activity |
| `CONVEX_DEPLOYMENT_URL` | Convex backend URL |
| `CONVEX_PRODUCT_KEY` | Convex admin auth |
| `AC_INSTANCE_ID` | Unique VPS id (consumer names, config filter) |

### Required for event ingest

| Variable | Purpose |
|----------|---------|
| `CONVEX_INGEST_SECRET` | Mutation auth for `serverEvents:ingestWorkerEventsBatch` |
| `CONVEX_WORKER_SECRET` | Query auth for worker sync + HUD |

### Required for `/ac-server` API

| Variable | Purpose |
|----------|---------|
| `API_KEY` | Header `x-api-key` |

### Required for admin UI

| Variable | Purpose |
|----------|---------|
| `ADMIN_JWT_SECRET` | Session cookie signing |
| `ADMIN_USER` / `ADMIN_PASS` | Login credentials |

### Dev vs prod

| Mode | Redis | telemetry | ac-data start |
|------|-------|-----------|---------------|
| **dev** | local `127.0.0.1:6379` | host `python3 main.py` | `./start.sh dev` |
| **prod** | cloud Redis URL | Docker | `./start.sh prod` |

### Common toggles (defaults usually fine)

| Variable | Default | Disable with |
|----------|---------|--------------|
| `REDIS_EVENTS_BRIDGE_ENABLED` | `true` | `false` — no Convex ingest from Redis |
| `REDIS_CONFIG_SYNC_ENABLED` | `true` | `false` — no Convex→Redis config publish |
| `REDIS_CONFIG_APPLIER_ENABLED` | `true` | `false` — no INI apply from Redis |
| `SERVER_POOL_ENABLED` | `false` | idle shutdown off |

Full list: ~87 vars read across ac-data; only the tables above are needed to boot.

## Deploy checklist

After **any** change to `ac-data/src/` (routes, services, controllers):

1. **Build** (prod uses `dist/`):
   ```bash
   cd ac-data && npm run build
   ```
2. **Restart ac-data** (tsx dev does not auto-reload route registration reliably across long runs):
   ```bash
   # from repo root
   ./stop.sh && ./start.sh dev   # or prod
   ```
3. **Verify health**:
   ```bash
   curl -s -b "admin_token=..." http://127.0.0.1:3000/admin/health | jq
   ```
4. **Smoke admin** — open `/admin/dashboard`, switch tabs (especially Activity after API changes).

### Symptoms of stale ac-data process

| Symptom | Cause |
|---------|-------|
| Activity shows "Error" / 404 on `/admin/activity/*` | Old process without new routes |
| HUD stale after code change | Bridge not restarted |
| Config not applying | Applier disabled or wrong `AC_INSTANCE_ID` |

## Health endpoint

`GET /admin/health` (requires admin auth) returns:

- `version` — from `package.json`
- `builtAt` — from `dist/build-info.json` after `npm run build`
- `redis` — ping + stream length + consumer pending count
- `convex` — configured yes/no
- `uptimeSec` — process uptime

## Development

```bash
cd ac-data
npm install
npm run dev          # tsx watch src/index.ts
npm test             # unit + integration tests
npm run build        # dist/ for production
```

## Refactor conventions

- **New Redis event side effects** → add handler in `src/services/eventHandlers/`, not inline in `redisConvexBridge.ts`.
- **New Redis reads/writes** → use `createRedisClient()` from `redisClient.ts`.
- **New admin features** → controller + route + panel under `public/js/panels/`.
