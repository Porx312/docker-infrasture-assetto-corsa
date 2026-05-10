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
│                     REDIS LOCAL                                  │
│              (Event Stream: ac:config, ac:events)                │
│              Installed on host, no authentication               │
└─────────────────┬─────────────────────────────┬─────────────────┘
                  │                             │
                  ▼                             ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│         ac-data (HOST)          │  │       telemetry (Docker)        │
│   Node.js service               │  │   Python service                 │
│   - Receives configs from Convex│  │   - Receives events from servers │
│   - Applies to server_cfg.ini   │  │   - Publishes to Redis           │
│   - Manages server lifecycle    │  │   - Auto-discovers servers       │
│   - Runs on host (spawns native │  │                                 │
│     AC server processes)        │  │                                 │
└───────────┬─────────────────────┘  └───────────────┬─────────────┘
            │                                       │
            ▼                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AC SERVER INSTANCES                           │
│   (Managed by ac-data on host, not in Docker)                    │
│                                                                  │
│   server/      UDP:9600  HTTP:8081  Plugin:12001                 │
│   server-1/    UDP:9610  HTTP:8082  Plugin:12011                 │
│   server-2/    UDP:9620  HTTP:8083  Plugin:12021                 │
│                                                                  │
│   Each has cfg/ with server_cfg.ini + entry_list.ini             │
│   Each has content/ symlinks to shared content                   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  assetto-manager (Docker)                       │
│   - Web UI at port 8772                                          │
│   - Manages AC installation (content from Steam)                  │
│   - Content path: /home/assetto/server-manager/assetto/          │
└─────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Type | Purpose | Port |
|---------|------|---------|------|
| `assetto-manager` | Docker | Web UI for content management | 8772 |
| `ac-data` | Host (Node.js) | Config bridge: Convex → servers | 3000 (API) |
| `telemetry` | Docker | Event processing, race telemetry | - |

**Important:** ac-data runs on the HOST (not in Docker) because it needs to spawn native AC server processes.

---

## Directory Structure

```
/home/jose/
├── assetto-infra/              # Main configuration directory
│   ├── docker-compose.yml      # Docker services (manager, telemetry)
│   ├── .env                    # Environment variables (secrets)
│   ├── config.yml             # Assetto Server Manager config
│   ├── start-ac-data.sh       # Startup script for ac-data (host)
│   ├── ac-data.log             # ac-data logs
│   │
│   ├── ac-data/                # Node.js service source
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── controller/
│   │   │   └── services/
│   │   └── dist/               # Compiled output
│   │
│   └── telemetry-data/          # Python service source
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── main.py
│       └── core/
│
├── assetto-install/            # AC game installation (managed by assetto-manager)
│   └── assetto/
│       ├── acs.exe             # AC server binary
│       ├── content/            # EXTracted content (cars, tracks, weather)
│       └── server/            # Multiple server instances
│           ├── server/        # Instance 1 (UDP 9600)
│           │   ├── acServer -> (symlink to main binary)
│           │   ├── cfg/
│           │   │   ├── server_cfg.ini
│           │   │   └── entry_list.ini
│           │   └── content/ -> (symlinks to shared content)
│           ├── server-1/     # Instance 2 (UDP 9610)
│           ├── server-2/     # Instance 3 (UDP 9620)
│           └── acServer      # Main binary (shared)
```

---

## Server Instance Configuration

Each server instance (server, server-1, server-2) is lightweight - it shares the main `acServer` binary and content via symlinks.

### Port Assignment Formula

| Instance | UDP_PORT | TCP_PORT | HTTP_PORT | UDP_PLUGIN_LOCAL | UDP_PLUGIN_ADDRESS |
|----------|----------|----------|-----------|------------------|-------------------|
| server | 9600 | 9600 | 8081 | 12001 | 127.0.0.1:12000 |
| server-1 | 9610 | 9610 | 8082 | 12011 | 127.0.0.1:12010 |
| server-2 | 9620 | 9620 | 8083 | 12021 | 127.0.0.1:12020 |

### Server Folder Setup

```bash
# Navigate to server directory
cd /home/jose/assetto-install/assetto/server

# For EACH server instance, create content symlinks:
for instance in server server-1 server-2; do
  mkdir -p $instance/content
  ln -sf /home/assetto/server-manager/assetto/content/cars $instance/content/cars
  ln -sf /home/assetto/server-manager/assetto/content/tracks $instance/content/tracks
  ln -sf /home/assetto/server-manager/assetto/content/weather $instance/content/weather

  # Link to main acServer binary
  ln -sf $(pwd)/acServer $instance/acServer
done

# Verify structure
ls -la server/content/
# Should show: cars -> ..., tracks -> ..., weather -> ...
```

### server_cfg.ini Requirements

The `[SERVER]` section MUST include:
- `CARS=car_model` (in SERVER section, not at end of file)
- `TRACK=track_id` (in SERVER section, not at end of file)

```ini
[SERVER]
NAME=Server Display Name
UDP_PORT=9600
TCP_PORT=9600
HTTP_PORT=8081
MAX_CLIENTS=2
UDP_PLUGIN_LOCAL_PORT=12001
UDP_PLUGIN_ADDRESS=127.0.0.1:12000
CARS=ks_toyota_gt86
TRACK=pk_akina

[PRACTICE]
NAME=Practice Session
TIME=1440
IS_OPEN=1

[DYNAMIC_TRACK]
SESSION_START=100
RANDOMNESS=0
SESSION_TRANSFER=100
LAP_GAIN=0

[WEATHER_0]
GRAPHICS=3_clear
BASE_TEMPERATURE_AMBIENT=23
BASE_TEMPERATURE_ROAD=11
```

---

## Setup Steps

### 1. Base System

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Create Docker network
docker network create ac-network

# Log out and back in for group changes
```

### 2. Directory Setup

```bash
# Create directories
mkdir -p /home/jose/assetto-infra
mkdir -p /home/jose/assetto-install/assetto/server

# Install Node.js (for ac-data on host)
# Using nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 3. Prepare AC Content

The content (cars, tracks, weather) must be extracted (not .acd packages). Use assetto-manager to manage content:

```bash
# assetto-manager container has the content at:
# /home/assetto/server-manager/assetto/content/
```

### 4. Build ac-data (Host)

```bash
cd /home/jose/assetto-infra/ac-data
npm install
npm run build
```

### 5. Environment Variables

Create `/home/jose/assetto-infra/.env`:

```bash
# Redis (Local - installed on host with: sudo apt install redis-server)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=

# Convex
CONVEX_DEPLOYMENT_URL=https://your-deployment.convex.cloud
CONVEX_PRODUCT_KEY=dev:your-key
CONVEX_WORKER_SECRET=your_worker_secret
CONVEX_INGEST_SECRET=your_ingest_secret

# Instance (must be unique per VPS)
AC_INSTANCE_ID=vps-eu-2

# Security
AC_DATA_API_KEY=your_api_key
```

### 6. Create Server Instances

```bash
cd /home/jose/assetto-install/assetto/server

# Create server folders
mkdir -p server/cfg server-1/cfg server-2/cfg

# Create content symlinks for each (as shown above)

# Create acServer symlinks for each
for instance in server server-1 server-2; do
  ln -sf $(pwd)/acServer $instance/acServer
done
```

### 7. Start Redis (Local)

```bash
# Start Redis server
sudo redis-server --daemonize yes

# Verify Redis is running
redis-cli ping
# Should return: PONG
```

### 8. Start Services

```bash
# Start Docker containers (assetto-manager, telemetry)
cd /home/jose/assetto-infra
sudo docker compose up -d

# Start ac-data (host process)
./start-ac-data.sh

# Or manually:
cd /home/jose/assetto-infra/ac-data
source ../.env
node dist/index.js
```

### 8. Verify

```bash
# Check running processes
pgrep -a acServer    # Should show 3 instances
pgrep -a node        # Should show ac-data

# Check Docker containers
sudo docker ps

# View ac-data logs
tail -f /home/jose/assetto-infra/ac-data.log

# View telemetry logs
sudo docker logs -f telemetry
```

---

## Player Links

Players join via acstuff.club:

```
server:    https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8081
server-1: https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8082
server-2: https://acstuff.club/s/q:race/online/join?ip=YOUR_IP&httpPort=8083
```

Replace `YOUR_IP` with your VPS public IP.

---

## Common Issues

### "Error: entry list CAR_0 car ks_toyota_gt86 is illegal"
- Content symlinks are missing or broken
- Verify: `ls -la server/content/cars/ks_toyota_gt86/`
- Should show car folder, not .acd file

### "EACCES: permission denied" on server_cfg.ini
- Fix ownership: `sudo chown -R jose:jose /home/jose/assetto-install/assetto/server/`
- Or file is a broken symlink

### ac-data keeps restarting servers continuously
- The config version in Convex is changing on every poll
- Check that Convex worker is using stable version strings

### "Bind error" on port
- Another process is using the port
- Check: `sudo lsof -i :9600`
- Or adjust port numbers in server_cfg.ini

---

## Updating Configuration

### Convex sends to ac-data via Redis:

```json
{
  "event": "server_config_snapshot",
  "data": {
    "instanceId": "vps-eu-2",
    "version": "3:3:1234567890",
    "servers": [
      {
        "serverName": "server",
        "displayName": "New Name",
        "password": "",
        "track": "pk_akina",
        "trackConfig": "akina_downhill",
        "maxClients": 2,
        "entries": [
          {"model": "ks_toyota_gt86", "skin": "lightning_red", "count": 1}
        ]
      }
    ]
  }
}
```

ac-data applies these to the corresponding server folder's cfg files and restarts only the affected server.

---

## Notes

- ac-data runs on host because AC server is a native 32-bit binary that can't run in Docker without complex multi-arch setup
- All services use `network_mode: host` to simplify networking
- Redis and Convex are external cloud services
- assetto-manager content is the source of truth for cars/tracks