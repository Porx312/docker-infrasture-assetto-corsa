# Assetto Corsa Server Infrastructure

Automated infrastructure for managing Assetto Corsa dedicated servers with Redis-based event streaming and Convex cloud integration.

## Architecture

```
Python (Host/Dev, Docker/Prod) ──writes──> Redis (Local) ──reads──> Node.js (Host) ──forwards──> Convex (Cloud)
      │                                       │
      │                                       └── Spawns AC Servers (32-bit native)
      └── Reads AC server configs, sends events
```

## Services

| Service | Language | Dev | Prod | Purpose |
|---------|----------|-----|------|---------|
| `telemetry-data` | Python | Host | Docker | Reads AC server configs, publishes events to Redis |
| `ac-data` | Node.js | Host | Host | Manages AC server lifecycle, forwards to Convex |

**Important:** ac-data runs on HOST (not Docker) because it spawns native 32-bit AC server processes.

## Prerequisites

- Node.js 20+ (via nvm)
- Python 3.12+
- Redis (local for dev, cloud for prod)
- Docker (only for production telemetry-data)

## Quick Start

```bash
# 1. Install all dependencies
./install.sh

# 2. Configure environment (dev)
cp .env.example .env.local
nano .env.local
# Production: cp .env.example .env.production && nano .env.production

# 3. Start services (dev mode)
./start.sh dev

# 4. Verify
./start.sh status
pgrep -a acServer
```

## Commands

```bash
# Start services
./start.sh dev      # Development (Redis local, telemetry on host)
./start.sh prod     # Production (Redis cloud, telemetry in Docker)

# Stop services
./stop.sh           # Graceful stop
./stop.sh force     # Force kill

# Status check
./start.sh status   # Show running services

# Logs
tail -f ac-data.log         # ac-data logs
tail -f telemetry-data.log   # telemetry logs (dev)
redis-cli xlen ac:events     # Check Redis events
```

## Port Assignments

Each folder (`server`, `server-1`, `server-2`, …) should use the **Plugin** UDP port below in `UDP_PLUGIN_ADDRESS` so telemetry binds one listener per instance. Do not point two AC processes at the same plugin port (e.g. legacy `server/server_cfg.ini` and `server-2` both on `12000` — only one wins; battle mode will not apply to the other).

| Instance | UDP/TCP | HTTP | Plugin |
|----------|---------|------|--------|
| server | 9600 | 8081 | 12001 |
| server-1 | 9610 | 8082 | 12011 |
| server-2 | 9620 | 8083 | 12021 |
| server-3 | 9630 | 8084 | 12041 |
| server-4 | 9640 | 8085 | 12051 |
| server-5 | 9650 | 8086 | 12061 |
| server-6 | 9660 | 8087 | 12071 |
| server-7 | 9670 | 8088 | 12081 |
| server-8 | 9680 | 8089 | 12091 |
| server-9 | 9690 | 8090 | 12101 |
| server-10 | 9700 | 8091 | 12111 |
| server-11 | 9710 | 8092 | 12121 |

## Environment files

| File | When |
|------|------|
| `.env.example` | Template (copy, do not edit secrets here) |
| `.env.local` | `./start.sh dev` — local Redis, telemetry on host |
| `.env.production` | `./start.sh prod` — Redis in Docker, telemetry in Docker |

`./start.sh` exports `ASSETTO_ENV` and `ASSETTO_ENV_FILE` so **ac-data** and **telemetry-data** use the same file for the chosen mode. See [`.env.example`](.env.example) for all variables.

| Variable | Description |
|----------|-------------|
| `AC_INSTANCE_ID` | Unique VPS identifier |
| `REDIS_HOST` | Redis host |
| `REDIS_PORT` | Redis port |
| `SERVERS_PATH` | Path to AC server configs |
| `EVENTS_SERVERS_PATH` | Path for event server configs |
| `REDIS_CONFIG_APPLIER_RESTART_ON_BOOT` | Auto-restart servers on startup |

## Player Links

```
https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8081
https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8082
https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8083
```

## Troubleshooting

### ac-data not spawning AC servers
```bash
# Check if ports are available
netstat -tlnp | grep -E "9600|9610|9620"

# Check ac-data logs
tail -f ac-data.log
```

### Cars showing as "empty slots"
- Only `ks_toyota_gt86` has complete content locally
- Other cars in Convex config are filtered out automatically

### Servers not restarting after stop
- Delete stale `server_pids.json`: `rm server_pids.json`
- Or run `./stop.sh force` before starting

## CI/CD

Push to `main` → GitHub Actions deploys telemetry-data (`docker-compose.prod.yml`, `.env.production` on VPS) via SSH and verifies the container is running.

Required GitHub Secrets:
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- `CONVEX_DEPLOYMENT_URL`, `CONVEX_PRODUCT_KEY`
- `CONVEX_WORKER_SECRET`, `CONVEX_INGEST_SECRET`

## Known Gotchas

1. **Content must be extracted (not .acd packages)** - Symlinks in `server/*/content/` must point to extracted folders
2. **server_cfg.ini CARS/TRACK must be in [SERVER] section** - Not at end of file
3. **ac-data keeps restarting servers** - Convex config version is changing on every poll; use stable version strings