# telemetry-data — Architecture & Operations

Python service: UDP ACSP ingress → Redis `ac:events` + battle HUD keys. **No Convex client** — ac-data owns INI and cloud sync.

## Subsystem map

```
AC Server (UDP) → main.py (threads)
                    → packet_processor → handlers/*
                    → event_dispatcher → ac:events
                    → battle_hud_publisher → ac:hud:battle:*
ac:config → redis_config_sync → runtime_config (modes only)
ac:user:invalidated:* → user_ban_enforcer → kick UDP
```

| Subsystem | Key files | Role |
|-----------|-----------|------|
| UDP ingress | `main.py`, `core/packet_processor.py`, `core/handlers/*` | ACSP parse + dispatch |
| Redis publish | `network/event_dispatcher.py` | Async `XADD ac:events` |
| Battle | `engines/battlesystem/*` | Touge 1v1 FSM, matchmaking |
| Modes | `core/redis_config_sync.py`, `core/runtime_config.py` | Read `ac:config` snapshots |
| Ban | `core/user_ban_enforcer.py` | Read invalidation keys from ac-data |
| Driver lifecycle | `core/driver_lifecycle.py` | Ghost purge, `player_leave` |

See [`telemetry-data/REDIS_CONTRACT.md`](../telemetry-data/REDIS_CONTRACT.md) and [`docs/AC_DATA.md`](AC_DATA.md).

## Minimal environment variables

Loaded from repo `.env.local` / `.env.production` via `ASSETTO_ENV_FILE`.

### Required

| Variable | Purpose |
|----------|---------|
| `SERVERS_PATH` | Base path(s) to `server/`, `server-1/`, … (comma-separated OK) |
| `REDIS_HOST` | Redis for streams and HUD keys |
| `AC_INSTANCE_ID` | Must match VPS id in Convex / ac-data |

### Paths (optional)

| Variable | Purpose |
|----------|---------|
| `TIME_ATTACK_SERVERS_PATH` | Extra server roots |
| `EVENTS_SERVERS_PATH` | Extra server roots |
| `TELEMETRY_STATE_DIR` | Runtime state (default: telemetry-data dir) |

### Common toggles

| Variable | Default | Notes |
|----------|---------|-------|
| `REDIS_CONFIG_CONSUMER_ENABLED` | `true` | Modes from `ac:config` |
| `USER_BAN_ENABLED` | `true` | Kick banned Steam IDs |
| `BATTLE_HUD_ENABLED` | `true` | Redis battle overlay keys |
| `SERVER_STATUS_ON_CHANGE_ONLY` | `true` | Coalesce `server_status` |

Battle tuning: all `BATTLE_*` vars in [`core/settings.py`](../telemetry-data/core/settings.py) (re-exported in `engines/battlesystem/config.py`).

## Deploy checklist

After changes to `telemetry-data/`:

1. **Dev (host):** restart telemetry — `./stop.sh && ./start.sh dev` or restart `python3 main.py`
2. **Prod (Docker):** rebuild/restart container — `docker compose -f docker-compose.prod.yml up -d --build telemetry-data`
3. **Verify:** `redis-cli xlen ac:events` increases on join; logs show `listener started port=…`
4. **Cold start:** ac-data must publish `ac:config` before battle/time-attack modes apply (check logs for `runtime_config modes updated`)

### Symptoms

| Symptom | Cause |
|---------|-------|
| Modes unknown / laps ignored | No `ac:config` snapshot yet; ac-data not running |
| UDP bind error | Another telemetry instance on same plugin ports |
| Ban kick delayed | Normal — waits for ac-data `player_join` → Convex refresh |

## Development

```bash
cd telemetry-data
pip install -r requirements.txt
pytest
python3 main.py
```

## Refactor conventions

- New ACSP packet type → new file under `core/handlers/`, wire in `core/handlers/__init__.py`
- Ghost / leave logic → `core/driver_lifecycle.py` only
- INI field reads → `core/ini_config.py`
