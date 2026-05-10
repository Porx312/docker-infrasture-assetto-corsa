# Telemetry Service (Python)

Python service that processes race events from AC servers and publishes to Redis/Convex.

## Purpose

- Listens to UDP packets from AC servers for telemetry data
- Detects player joins/leaves, session changes, lap times
- Publishes events to Redis stream (ac:events) for Convex consumption
- Automatically discovers servers from server_cfg.ini files

## Architecture

```
AC Servers ──UDP──► telemetry ──► Redis Stream (ac:events) ──► Convex
                     │
                     └── Also subscribes to ac:config for config updates
```

## Running

Runs as a Docker container via docker-compose:

```bash
docker compose up -d telemetry
docker logs -f telemetry
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVERS_PATH` | Path to AC server installations | (required) |
| `EVENTS_SERVERS_PATH` | Path for event server configs | (required) |
| `AC_INSTANCE_ID` | Unique instance identifier | default |
| `REDIS_HOST` | Redis server hostname | (required) |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | (required) |
| `REDIS_CONFIG_CONSUMER_ENABLED` | Enable config sync | true |
| `SERVER_STATUS_POLL_INTERVAL_SEC` | Server poll frequency | 15 |
| `SERVER_STATUS_PUBLISH_INTERVAL_SEC` | Status publish frequency | 30 |
| `SERVER_STATUS_HEARTBEAT_INTERVAL_SEC` | Heartbeat interval | 300 |

## Server Discovery

The telemetry service automatically discovers AC servers by scanning for `server_cfg.ini` files in the paths specified by `SERVERS_PATH` and `EVENTS_SERVERS_PATH`.

For each server found, it extracts:
- `UDP_PLUGIN_LOCAL_PORT` - port for receiving telemetry
- `UDP_PLUGIN_ADDRESS` - server command port
- `NAME` / `SERVER_NAME` - display name
- `TRACK` / `CONFIG_TRACK` - track info

## Event Types Published

- `player_join` - Player connected to server
- `player_leave` - Player disconnected from server
- `server_status` - Periodic server state (players, track)
- `server_config_applied` - Configuration was updated

## Content Access

The telemetry container needs access to AC content (cars, tracks) for checksum validation. This is provided via volume mount from the host's assetto installation.

Volume mount: `/home/jose/assetto-install/assetto/server` → `/opt/assetto/servers/server1`

The service reads server configurations but does NOT need content files to function - it only needs the port and name information from server_cfg.ini.