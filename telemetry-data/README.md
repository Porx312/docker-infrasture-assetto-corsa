# Telemetry Service (Python)

Python service that processes race events from AC servers and publishes to Redis for the `ac-data` bridge → Convex.

## Purpose

- Listens to UDP packets from AC servers (ACSP protocol)
- Detects player joins/leaves, session changes, lap times, battles
- Publishes events to Redis stream `ac:events`
- Consumes `ac:config` snapshots to update in-memory server modes (battle / time-attack / event)

## Architecture

```
AC Servers ──UDP──► telemetry-data ──► Redis (ac:events) ──► ac-data ──► Convex
                         │
                         └── Redis (ac:config) ◄── ac-data (Convex poll)
                              └── runtime_config only (modes); ac-data writes INI
```

## Running

**Development** (host, via repo `start.sh dev`):

```bash
./start-telemetry.sh
# or: cd telemetry-data && python3 main.py
```

**Production** (Docker on VPS):

```bash
docker compose -f docker-compose.prod.yml up -d telemetry-data
docker logs -f assetto-telemetry-data
```

CI deploy on `main` rebuilds the container via `docker-compose.prod.yml` using `.env.production` on the VPS.

## Server folders (`server-1`, `server-2`, …)

Convex identifies each instance by **folder slug** (`serverName` = `server-1`, `server-2`, …), not by the AC display name (`NAME=` / `akina`). Telemetry resolves battle/time-attack mode using that folder id first, then display names.

At startup you should see lines like:

```text
listener mapping port=12020 folder=server-2 mode=battle display=battle test cfg=.../server-2/cfg/server_cfg.ini
```

### UDP port conflicts (common pitfall)

If two `server_cfg.ini` files use the same `UDP_PLUGIN_ADDRESS` listen port (e.g. both `127.0.0.1:12000`), only **one** listener is registered. Telemetry prefers `server-N/cfg/server_cfg.ini` over legacy `server/server_cfg.ini`.

| Path | Typical issue |
|------|----------------|
| `server/server_cfg.ini` | Legacy `NAME=akina` on port **12000** |
| `server/server/cfg/server_cfg.ini` | Duplicate **12000** — ignored if root wins first |
| `server/server-2/cfg/server_cfg.ini` | Should use **12020** (see root README port table) |

**Operational fix:** give each running AC instance a unique `UDP_PLUGIN_ADDRESS` port aligned with its folder (e.g. `server-2` → `12020`). Players must join the AC process that uses that folder’s cfg, not an old `akina` server on 12000.

Set `SKIP_LEGACY_SERVER_CFG=true` (default) to omit `{SERVERS_PATH}/server_cfg.ini` when at least one `server-N/cfg/` exists.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVERS_PATH` | Comma-separated paths with `server_cfg.ini` | (required) |
| `SKIP_LEGACY_SERVER_CFG` | Skip root `server_cfg.ini` when `server-N/cfg/` exist | `true` |
| `TIME_ATTACK_SERVERS_PATH` | Optional extra server roots | — |
| `EVENTS_SERVERS_PATH` | Optional extra server roots | — |
| `AC_INSTANCE_ID` | VPS instance id (must match Convex) | `default` |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection | (required) |
| `REDIS_STREAM_MAXLEN` | `ac:events` trim size | `200000` |
| `REDIS_CONFIG_CONSUMER_ENABLED` | Consume `ac:config` for modes | `true` |
| `REDIS_CONFIG_INI_WRITE_ENABLED` | Python writes INI (legacy) | `false` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `SERVER_STATUS_*` | Status poll / publish / heartbeat | see repo root [`.env.example`](../.env.example) |

## Tests

```bash
cd telemetry-data
pip install -r requirements.txt
pytest -q
```

## Battle mode (touge)

Full documentation (architecture, state machine, scoring, Redis events): **[docs/BATTLE_MODE.md](docs/BATTLE_MODE.md)**.

Summary: 1v1 touge pairs matched automatically when close and fast; states `IDLE` → `ARMED` → `LAUNCHING` → `ACTIVE` → `FINISHED`; run ends when the lead completes the lap; **5 s** sustained proximity before ARMED with `BATTLE ARM` countdown chat (`BATTLE_ARM_SUSTAINED_PROXIMITY_SEC`); no post-finish rematch cooldown.

## Event Types Published

- `player_join`, `player_leave`, `lap_completed`, `server_status`
- `battle_update`, `battle_finished`
- `server_config_applied` (only if `REDIS_CONFIG_INI_WRITE_ENABLED=true`)

See [REDIS_CONTRACT.md](REDIS_CONTRACT.md) for the full stream schema.
