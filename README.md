# Assetto Corsa Server Infrastructure

Automated infrastructure for managing Assetto Corsa dedicated servers with Redis-based event streaming and Convex cloud integration.

## Architecture

```
telemetry-data ──> Redis (shared) <── ac-data-edge (VPS)
                         │                    │
                         │                    ├── AC servers + HUD WSS
                         │                    └── ingest/worker ──> ac-data-backend (hub)
                         │                                              │
                         └── HUD presence / roster                       ├── Convex
                                                                        └── Control API / admin
```

Docs index: **[docs/README.md](docs/README.md)**. Fleet checklist: [docs/VPS_FLEET_SETUP.md](docs/VPS_FLEET_SETUP.md).

## Services

| Service | Language | Where | Purpose |
|---------|----------|-------|---------|
| `telemetry-data` | Python | Host / Docker | AC UDP → Redis `ac:events` |
| `ac-data-edge` | Node.js | Game VPS (host, not Docker) | Spawn AC, Redis bridge, HUD WSS, mod agent |
| `ac-data-backend` | Node.js | Hub (Dokploy) | Convex ingest, admin, HUD gateway, Control API |
| `ac-data-shared` | Node.js | npm workspace | Contracts (keys, fleet, secrets) |

**Important:** `ac-data-edge` runs on the host (not Docker) because it spawns native 32-bit AC processes.

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
./stop.sh              # Full stop (edge + telemetry + AC lobbies)
./stop.sh force        # Force kill everything
./stop.sh infra        # Edge + telemetry only (keep acServer lobbies)

# Apply code changes without killing lobbies (fleet uses dev)
./reload-infra.sh        # defaults to dev
./reload-infra.sh dev
./reload-infra.sh prod   # only if a host uses .env.production + Docker telemetry

# Status check
./start.sh status   # Show running services

# Logs (under logs/; override with LOG_DIR=...)
tail -f logs/ac-data-edge.log
tail -f logs/ac-data-backend.log
tail -f logs/telemetry-data.log   # telemetry (dev / host)
redis-cli xlen ac:events          # Check Redis events

# Log rotation (prevents logs filling the disk)
# Preferred (no sudo): cron runs scripts/rotate-assetto-logs.sh every 30m
#   crontab -l | grep rotate-assetto-logs
# Optional system logrotate:
#   sudo cp scripts/logrotate-assetto.conf /etc/logrotate.d/assetto-infra
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
| server-12 | 9720 | 8093 | 12131 |
| server-13 | 9730 | 8094 | 12141 |
| server-14 | 9740 | 8095 | 12151 |
| server-15 | 9750 | 8096 | 12161 |
| server-16 | 9760 | 8097 | 12171 |
| server-17 | 9770 | 8098 | 12181 |
| server-18 | 9780 | 8099 | 12191 |
| server-19 | 9790 | 8100 | 12201 |

## Environment files

| File | When |
|------|------|
| `.env.example` | Template (copy, do not edit secrets here) |
| `.env.local` | `./start.sh dev` — shared Redis (`REDIS_HOST`), telemetry on host |
| `.env.production` | `./start.sh prod` — same shared Redis; telemetry in Docker |

`./start.sh` exports `ASSETTO_ENV` and `ASSETTO_ENV_FILE` so **ac-data-edge** and **telemetry-data** use the same file for the chosen mode. See [`.env.example`](.env.example) for all variables. Local `redis-server` is only started if `REDIS_HOST` is `127.0.0.1`/`localhost`.

| Variable | Description |
|----------|-------------|
| `AC_INSTANCE_ID` | Unique VPS identifier |
| `REDIS_HOST` | Redis host (same as hub/backend — not a per-VPS Redis) |
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

### ac-data-edge not spawning AC servers
```bash
# Check if ports are available
netstat -tlnp | grep -E "9600|9610|9620"

# Check ac-data-edge logs
tail -f logs/ac-data-edge.log
```

### Cars showing as "empty slots"
- Only `ks_toyota_gt86` has complete content locally
- Other cars in Convex config are filtered out automatically

### Servers not restarting after stop
- Delete stale `server_pids.json`: `rm server_pids.json`
- Or run `./stop.sh force` before starting

## Control API (hub `/v1`)

The hub exposes a **Control API** for ProjectD Host (mods inventory, live lobbies, desired-config). See **[docs/README.md](docs/README.md)**.

| Doc | Purpose |
|-----|---------|
| [docs/CONTROL_API_V1.md](docs/CONTROL_API_V1.md) | Canonical API spec |
| [docs/openapi/control-api-v1.yaml](docs/openapi/control-api-v1.yaml) | OpenAPI v1 |
| [docs/SERVER_PLATFORM.md](docs/SERVER_PLATFORM.md) | Host start / live roster |

## CI/CD

Push to `main` → GitHub Actions deploys **edge (infra) VPS** in parallel (see [`deploy/fleet.json`](deploy/fleet.json)): each target SSHs in with **per-VPS** credentials, runs [`scripts/deploy-from-main.sh`](scripts/deploy-from-main.sh) (`git reset --hard origin/main`, `npm ci`, `./reload-infra.sh dev`), then health-checks. **Does not** overwrite `.env.local`.

The **hub/backend** is deployed separately via **Dokploy** (not this workflow).

Workflow: develop/test on **vps-test** → push/merge to `main` → Actions updates all fleet edges. Do not edit code by hand on prod edge VPS hosts.

### Repository secrets (3 per VPS)

| Fleet id | Host | User | SSH private key | Repo path (`fleet.json`) |
|----------|------|------|-----------------|--------------------------|
| `edge-1` | `VPS_HOST_EDGE_1` | `VPS_USER_EDGE_1` | `VPS_SSH_KEY_EDGE_1` | `/home/jose/assetto-infra` |
| `edge-2` | `VPS_HOST_EDGE_2` | `VPS_USER_EDGE_2` (`root`) | `VPS_SSH_KEY_EDGE_2` | `/root/assetto-infra` |
| `edge-3` | `VPS_HOST_EDGE_3` | `VPS_USER_EDGE_3` | `VPS_SSH_KEY_EDGE_3` | `/home/jose/assetto-infra` |

Create them under Settings → Secrets and variables → Actions → **Repository secrets** (not Variables). Host = public IP/hostname; key = full PEM private key.

To add a 4th edge: new row in `deploy/fleet.json` + 3 secrets (`VPS_HOST_EDGE_4`, `VPS_USER_EDGE_4`, `VPS_SSH_KEY_EDGE_4`) + matching `case` branches in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (Actions cannot resolve secret names dynamically).

## Applying code changes (why a full restart used to be needed)

| What you edited | What must reload | How |
|-----------------|------------------|-----|
| `packages/ac-data-edge` / `shared` | Node edge | `./reload-infra.sh` (or save file if `tsx watch` is already running) |
| `telemetry-data/` (dev / fleet) | Host `python3 main.py` | `./reload-infra.sh` restarts the host process |
| `telemetry-data/` (prod Docker) | Docker image | `./reload-infra.sh prod` rebuilds + recreates container |
| Lobby INI / config snapshot | That `acServer` only | Config applier (no full stop) |
| Everything broken / clean slate | All processes | `./stop.sh` then `./start.sh dev` |

Fleet VPS and GitHub Actions edge deploy use **dev** (`.env.local`). Infra-only reload keeps lobbies up; the edge **adopts** living `acServer` PIDs on boot. Set `AC_CLEANUP_KILL_ORPHANS=true` only for the old kill-orphans-on-boot behavior.

## Known Gotchas

1. **Content must be extracted (not .acd packages)** - Symlinks in `server/*/content/` must point to extracted folders
2. **server_cfg.ini CARS/TRACK must be in [SERVER] section** - Not at end of file
3. **Edge keeps restarting servers** - Convex config version is changing on every poll; use stable version strings
4. **If a host uses prod Docker telemetry** - host `.py` edits are ignored until `./reload-infra.sh prod`