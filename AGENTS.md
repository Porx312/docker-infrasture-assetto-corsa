# AGENTS.md

## Architecture

- **ac-data** (Node.js/TypeScript): Runs on HOST — spawns native 32-bit AC server processes
- **telemetry-data** (Python): Dev = Host (`python3 main.py`), Prod = Docker
- **Redis**: Local for dev (`redis-server --daemonize yes`), Cloud for prod
- **Convex**: Cloud config source; ac-data bridges Convex → Redis → server_cfg.ini

## Key Commands

```bash
# Full setup (install deps, open ports, build ac-data)
./install.sh

# Dev startup (Redis local, telemetry on host)
./start.sh dev

# Prod startup (Redis cloud, telemetry in Docker)
./start.sh prod

# Stop services
./stop.sh
./stop.sh force

# Status check
./start.sh status

# Logs
tail -f ac-data.log
tail -f telemetry-data.log
redis-cli xlen ac:events
```

## Critical Paths

- AC server binary: `/home/jose/assetto-install/assetto/server/acServer`
- Server instances: `server/`, `server-1/`, `server-2/` with symlinks to shared content
- Content source: `/home/assetto/server-manager/assetto/content/`

## Port Assignments

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

## Known Gotchas

1. **ac-data cannot run in Docker** — AC server is 32-bit native; must run on host
2. **Content must be extracted (not .acd packages)** — Symlinks in `server/*/content/` must point to extracted folders
3. **Cars filtered by local content** — Only `ks_toyota_gt86` has complete local content
4. **server_cfg.ini CARS/TRACK must be in [SERVER] section** — Not at end of file
5. **ac-data continuously restarting servers** — Convex config version changing on every poll; use stable version strings
6. **Servers not restarting after stop** — Delete stale `server_pids.json`
7. **Config race** — Keep `REDIS_CONFIG_INI_WRITE_ENABLED=false` in telemetry; ac-data owns INI writes + restarts

## CI/CD

- Push to `main` → GitHub Actions deploys telemetry-data via SSH to VPS
- Health check: `curl http://HOST:3000/api/health`

## References

- `README.md` — Quick start and architecture
- `SETUP_GUIDE.md` — Full setup with troubleshooting
- `docs/VPS_CAPACITY.md` — VPS sizing, 300 on-demand pool, hardware checklist
- `scripts/vps-capacity-check.sh` — RAM/CPU/acServer snapshot on the host
- `scripts/load-test-ac-servers.sh` — start N servers via API and log metrics
- `install.sh` — Automated dependency installation