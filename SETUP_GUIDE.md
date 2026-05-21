# Assetto Corsa Server Setup Guide

## Overview

This infrastructure manages multiple Assetto Corsa dedicated server instances with centralized configuration via Convex and Redis.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONVEX CLOUD                              │
│                   (Configuration Source)                          │
└────────────────────────────┬───────────────────────────────────┘
                             │ queries
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     REDIS (Local/Cloud)                          │
│              (Event Stream: ac:config, ac:events)                │
└─────────────────┬─────────────────────────────┬─────────────────┘
                  │                             │
                  ▼                             ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│         ac-data (HOST)           │  │       telemetry-data              │
│   Node.js service              │  │   Python service                  │
│   - Receives configs from Convex│  │   - Receives events from servers  │
│   - Applies to server_cfg.ini   │  │   - Publishes to Redis           │
│   - Manages server lifecycle    │  │   - Auto-discovers servers       │
│   - Spawns native AC processes  │  │                                  │
│                                 │  │   Dev: Host (python3 main.py)    │
│                                 │  │   Prod: Docker                  │
└───────────┬─────────────────────┘  └───────────────┬─────────────┘
            │                                       │
            ▼                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AC SERVER INSTANCES                           │
│   (Native 32-bit, managed by ac-data on HOST)                    │
│                                                                  │
│   server/      UDP:9600  HTTP:8081  Plugin:12001                 │
│   server-1/    UDP:9610  HTTP:8082  Plugin:12011                 │
│   server-2/    UDP:9620  HTTP:8083  Plugin:12021                 │
│                                                                  │
│   Each has cfg/ with server_cfg.ini + entry_list.ini             │
│   Each has content/ symlinks to shared content                   │
└─────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Type | Dev | Prod | Purpose |
|---------|------|-----|------|---------|
| `ac-data` | Node.js | Host | Host | Config bridge: Convex → servers |
| `telemetry-data` | Python | Host | Docker | Event processing, telemetry |

**Important:** ac-data runs on HOST (not Docker) because it spawns native 32-bit AC server processes.

---

## Directory Structure

```
/home/jose/
├── assetto-infra/              # Main configuration directory
│   ├── .env.example           # Template (copy to .env.local or .env.production)
│   ├── .env.local             # Dev secrets (start.sh dev)
│   ├── .env.production        # Prod secrets (start.sh prod)
│   ├── config.yml             # Assetto Server Manager config
│   ├── start.sh               # Main startup script
│   ├── stop.sh                # Stop script
│   ├── install.sh             # Full setup installer
│   ├── start-telemetry.sh     # Telemetry start script (dev)
│   ├── ac-data.log            # ac-data logs
│   ├── telemetry-data.log     # telemetry logs (dev)
│   ├── server_pids.json        # AC server PIDs
│   │
│   ├── ac-data/               # Node.js service
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── controller/
│   │   │   └── services/
│   │   └── dist/              # Compiled output (ES2020)
│   │
│   └── telemetry-data/         # Python service
│       ├── requirements.txt
│       ├── main.py
│       └── core/
│
├── assetto-install/           # AC game installation
│   └── assetto/
│       ├── server/            # AC server binaries + instances
│       │   ├── acServer       # Main binary (shared)
│       │   ├── server/        # Instance 1 (UDP 9600)
│       │   ├── server-1/      # Instance 2 (UDP 9610)
│       │   └── server-2/      # Instance 3 (UDP 9620)
│       └── content/           # Shared content source
│
└── assetto-server-manager/    # Assetto Server Manager (Docker)
    └── assetto/content/       # Steam content (extracted)
```

---

## Server Instance Configuration

Each server instance (server, server-1, server-2) is lightweight - shares the main `acServer` binary and content via symlinks.

### Port Assignment

| Instance | UDP_PORT | TCP_PORT | HTTP_PORT | UDP_PLUGIN_LOCAL | UDP_PLUGIN_ADDRESS |
|----------|----------|----------|-----------|------------------|-------------------|
| server | 9600 | 9600 | 8081 | 12001 | 127.0.0.1:12000 |
| server-1 | 9610 | 9610 | 8082 | 12011 | 127.0.0.1:12010 |
| server-2 | 9620 | 9620 | 8083 | 12021 | 127.0.0.1:12020 |

### Server Folder Setup

```bash
cd /home/jose/assetto-install/assetto/server

for instance in server server-1 server-2; do
  mkdir -p $instance/content
  ln -sf /home/assetto/server-manager/assetto/content/cars $instance/content/cars
  ln -sf /home/assetto/server-manager/assetto/content/tracks $instance/content/tracks
  ln -sf /home/assetto/server-manager/assetto/content/weather $instance/content/weather
  ln -sf $(pwd)/acServer $instance/acServer
done

# Verify
ls -la server/content/
```

### server_cfg.ini Requirements

The `[SERVER]` section MUST include:
- `CARS=car_model` (in SERVER section, not at end of file)
- `TRACK=track_id` (in SERVER section, not at end of file)

---

## Setup Steps

### 1. Run Full Installer

```bash
./install.sh
```

This installs:
- System dependencies (build-essential, redis-server, python3, pip, iptables)
- Node.js 20 via nvm
- Python dependencies (python-dotenv, redis)
- Opens firewall ports
- Sets up ac-data (npm install && npm run build)
- Creates content symlinks
- Starts Redis

### 2. Environment Variables

Copy the template once per environment:

```bash
cp .env.example .env.local          # dev
cp .env.example .env.production     # prod (VPS)
nano .env.local
```

`./start.sh` exports `ASSETTO_ENV` and `ASSETTO_ENV_FILE` so ac-data and telemetry-data load the same file. Do not use a separate root `.env`.

Key variables:
- `AC_INSTANCE_ID` - Unique VPS identifier
- `REDIS_HOST` / `REDIS_PORT` - Redis connection
- `SERVERS_PATH` - Path to AC server configs
- `EVENTS_SERVERS_PATH` - Path for telemetry event servers
- `REDIS_CONFIG_APPLIER_RESTART_ON_BOOT=true` - Auto-start servers

### 3. Start Services

```bash
./start.sh dev
```

### 4. Verify

```bash
# Check AC servers
pgrep -a acServer

# Check services
./start.sh status

# Check logs
tail -f ac-data.log
tail -f telemetry-data.log

# Check Redis events
redis-cli xlen ac:events
```

---

## Player Links

Players join via acstuff.club:

```
https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8081
https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8082
https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8083
```

---

## Common Issues

### "Error: entry list CAR_0 car ks_toyota_gt86 is illegal"
- Content symlinks are missing or broken
- Verify: `ls -la server/content/cars/ks_toyota_gt86/`
- Should show car folder, not .acd file

### "EACCES: permission denied" on server_cfg.ini
- Fix ownership: `sudo chown -R jose:jose /home/jose/assetto-install/assetto/server/`
- Or file is a broken symlink

### ac-data keeps restarting servers
- Convex config version is changing on every poll
- Use stable version strings in Convex worker

### "Bind error" on port
- Another process is using the port
- Check: `sudo lsof -i :9600`

### Servers not starting after stop
- Delete stale PID file: `rm server_pids.json`
- Or run `./stop.sh force`

---

## Environment Variables Reference

All services share the repo-root [`.env.example`](.env.example) template (copied to `.env.local` or `.env.production`).

### ac-data + telemetry-data (shared)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | 127.0.0.1 | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `REDIS_STREAM_KEY` | ac:events | Events stream key |
| `REDIS_CONFIG_STREAM_KEY` | ac:config | Config stream key |
| `AC_INSTANCE_ID` | - | Unique VPS ID |
| `SERVERS_PATH` | - | Path to AC server configs |
| `EVENTS_SERVERS_PATH` | - | Path for event server configs |
| `REDIS_CONFIG_APPLIER_RESTART_ON_BOOT` | false | Auto-restart servers (ac-data) |
| `API_KEY` | - | API authentication (ac-data) |
| `CORS_ORIGIN` | - | CORS allowed origin (ac-data) |
| `SERVER_STATUS_POLL_INTERVAL_SEC` | 15 | Local poll cadence (telemetry) |
| `SERVER_STATUS_PUBLISH_INTERVAL_SEC` | 30 | Publish on-change cadence (telemetry) |
| `SERVER_STATUS_HEARTBEAT_INTERVAL_SEC` | Heartbeat interval |

---

## Notes

- ac-data runs on host because AC server is 32-bit native
- In dev mode, telemetry-data runs on host via `start-telemetry.sh`
- In prod mode, telemetry-data runs in Docker
- Redis can be local (dev) or cloud (prod)
- Convex is the cloud config source of truth