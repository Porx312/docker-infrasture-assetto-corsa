# ac-data

Node.js service that bridges Redis and Convex for Assetto Corsa server configuration management.

## Purpose

- Receives server configuration snapshots from Convex via Redis stream
- Applies configuration changes (name, password, cars, track, trackConfig) to server_cfg.ini
- Manages AC server lifecycle: stop → configure → restart
- Publishes events to Redis for downstream consumers (telemetry)

## Architecture

```
Convex ──────► Redis Stream (ac:config) ──────► ac-data ──────► AC Servers
                          │                        │
                          │                        ▼
                          │                 Modifies cfg files
                          │                        │
                          ▼                        ▼
                    ac:events              restart server process
                          │
                          ▼
                    telemetry (Python)
```

## Running on Host (Not Containerized)

ac-data runs directly on the host machine (not in Docker) because it needs to spawn native AC server processes.

### Start Script

Create `/home/jose/assetto-infra/start-ac-data.sh`:

```bash
#!/bin/bash
cd /home/jose/assetto-infra/ac-data

export REDIS_HOST=your-redis-host
export REDIS_PORT=12827
export REDIS_USERNAME=default
export REDIS_PASSWORD=your-password
export CONVEX_DEPLOYMENT_URL=https://your-deployment.convex.cloud
export CONVEX_PRODUCT_KEY=dev:your-key
export CONVEX_WORKER_SECRET=your-worker-secret
export CONVEX_INGEST_SECRET=your-ingest-secret
export AC_INSTANCE_ID=vps-eu-2
export SERVERS_PATH=/home/jose/assetto-install/assetto/server
export RESTART_ON_BOOT=false

exec node dist/index.js >> /home/jose/assetto-infra/ac-data.log 2>&1
```

### Build

```bash
cd /home/jose/assetto-infra/ac-data
npm install
npm run build  # Compiles TypeScript to dist/
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_HOST` | Redis server hostname (use `127.0.0.1` for local) | Yes |
| `REDIS_PORT` | Redis port (default: `6379`) | Yes |
| `REDIS_PASSWORD` | Redis password (leave empty for local Redis) | No |
| `CONVEX_DEPLOYMENT_URL` | Convex deployment URL | Yes |
| `CONVEX_PRODUCT_KEY` | Convex auth key | Yes |
| `CONVEX_WORKER_SECRET` | Worker secret for queries | Yes |
| `CONVEX_INGEST_SECRET` | Ingest secret for mutations | Yes |
| `AC_INSTANCE_ID` | Unique instance identifier | Yes |
| `SERVERS_PATH` | Path to server folder | Yes |
| `RESTART_ON_BOOT` | Auto-restart servers on startup | No (default: false) |

## Server Folder Structure

The `SERVERS_PATH` contains multiple AC server instances:

```
/home/jose/assetto-install/assetto/server/
├── server/           # Server instance 1
│   ├── acServer      # Symlink to main acServer binary
│   ├── cfg/
│   │   ├── server_cfg.ini
│   │   └── entry_list.ini
│   └── content/      # Symlinks to shared content
├── server-1/         # Server instance 2
│   ├── acServer
│   ├── cfg/
│   └── content/
├── server-2/         # Server instance 3
│   ├── acServer
│   ├── cfg/
│   └── content/
├── acServer          # Main AC server binary
└── content/          # Shared content (cars, tracks, weather)
    ├── cars
    ├── tracks
    └── weather
```

### Port Configuration Formula

Each server instance must have unique ports:

| Server | UDP_PORT | TCP_PORT | HTTP_PORT | UDP_PLUGIN_LOCAL_PORT | UDP_PLUGIN_ADDRESS |
|--------|----------|----------|-----------|----------------------|-------------------|
| server | 9600 | 9600 | 8081 | 12001 | 127.0.0.1:12000 |
| server-1 | 9610 | 9610 | 8082 | 12011 | 127.0.0.1:12010 |
| server-2 | 9620 | 9620 | 8083 | 12021 | 127.0.0.1:12020 |

### Content Symlinks

Each server's `content/` folder should symlink to the assetto-manager's content:

```bash
# For each server (server, server-1, server-2):
ln -sf /home/assetto/server-manager/assetto/content/cars /path/to/server/content/cars
ln -sf /home/assetto/server-manager/assetto/content/tracks /path/to/server/content/tracks
ln -sf /home/assetto/server-manager/assetto/content/weather /path/to/server/content/weather
```

## Server Lifecycle

When ac-data receives a config update from Convex:

1. **Identify** the server by name (server, server-1, server-2)
2. **Stop** the running AC server process (SIGKILL)
3. **Configure** update server_cfg.ini with new values:
   - NAME (display name)
   - PASSWORD
   - CARS (car models)
   - TRACK (track ID)
   - CONFIG_TRACK (track variant)
   - MAX_CLIENTS
4. **Regenerate** entry_list.ini with car/skin configurations
5. **Start** the AC server process with new configuration

Only the affected server is restarted - other servers continue running.

## Logs

- Process logs: `/home/jose/assetto-infra/ac-data.log`
- Server logs: Visible in the same log file (stdout from AC server processes)

## Troubleshooting

### Server fails to start with "illegal car"
- The content folder symlinks are incorrect or missing
- Verify: check that `content/cars/<car_name>/data/` folder exists

### "EACCES: permission denied" on server_cfg.ini
- Fix ownership: `sudo chown -R jose:jose /home/jose/assetto-install/assetto/server/`
- Or check if file is a symlink pointing to a non-existent path

### Port binding errors
- Another process is using the port
- Check: `netstat -ulnp | grep <port>`
- Kill conflicting processes or reassign ports in server_cfg.ini