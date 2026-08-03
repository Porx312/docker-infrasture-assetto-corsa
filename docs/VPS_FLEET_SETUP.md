# VPS fleet setup (multi-host, shared Redis)

Use this when running **more than one VPS** against the same Redis Cloud and Convex deployment.

## Per-VPS variables (must differ)

| Variable | Example VPS1 | Example VPS2 |
|----------|--------------|--------------|
| `AC_INSTANCE_ID` | `vps-eu-1` | `vps-eu-2` |
| `REDIS_CONSUMER_NAME` | `ac-data-vps-eu-1` | `ac-data-vps-eu-2` |
| `REDIS_CONFIG_CONSUMER_NAME` | `py-vps-eu-1` | `py-vps-eu-2` |

Copy `.env.example` to `.env.production` (prod) or `.env.local` (dev), then change **only** the values above (and host-specific paths like `SERVERS_PATH` if needed).

## Shared across fleet (normal)

- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_SSL`
- `REDIS_CONSUMER_GROUP` (same group, different consumer names)
- `REDIS_CONFIG_CONSUMER_GROUP`
- `CONVEX_DEPLOYMENT_URL`, Convex secrets

## Convex worker instance

`AC_INSTANCE_ID` must match a worker instance registered in Convex (worker sync / config stream). If the clone reuses the primary instance ID, Convex config and Redis `ac:config` updates apply to the wrong host.

Verify in ac-data logs after start:

```text
[redis-config-applier] instance=vps-eu-2 ...
[redis-bridge] instance=vps-eu-2 ...
```

## Battle HUD and Redis key collisions

Battle snapshots use:

```text
ac:hud:battle:{AC_INSTANCE_ID}_{lobby_name}:{steamId}
```

Telemetry (`battle_hud_publisher.py`) and ac-data (`buildBattleServerKey`) both prefix with `AC_INSTANCE_ID`. Two VPS can share the same lobby `NAME=` in `server_cfg.ini` **without** overwriting each other's battle HUD as long as `AC_INSTANCE_ID` differs.

If you run old code without the instance prefix, or duplicate `AC_INSTANCE_ID`, battles on shared Redis will mix or lag.

## Overlay URL

The in-game overlay must connect to **ac-data on the same VPS** where the player is racing.

**Staging (HTTPS via Caddy):**

```text
https://dev-api.projectd.touge.com/hud/stream?steamId={steamId}
```

**Direct (legacy / debug only):**

```text
http://{THIS_VPS_IP}:3000/hud/stream?steamId={steamId}
```

See [`docs/STAGING_HTTPS.md`](STAGING_HTTPS.md) for Cloudflare + Caddy setup.

HUD CORS uses `HUD_CORS_ORIGIN` (default `*`), not admin `CORS_ORIGIN`.

## Services layout

| Service | Where it runs |
|---------|----------------|
| ac-data | Host (never Docker) — restart manually after deploy |
| telemetry-data | Dev: host · Prod: Docker (`docker-compose.prod.yml`) |
| Redis | Dev: local · Prod: Redis Cloud |

CI (`.github/workflows/deploy.yml`) rebuilds telemetry Docker only; **restart ac-data** after backend changes.

## Checklist after cloning a VPS

1. Set unique `AC_INSTANCE_ID`, `REDIS_CONSUMER_NAME`, `REDIS_CONFIG_CONSUMER_NAME`.
2. Register the instance in Convex worker sync.
3. Confirm both ac-data and telemetry use the same `REDIS_*` from the active env file.
4. Run `./scripts/verify-vps-instance-config.sh`
5. Run `./scripts/verify-battle-pipeline.sh [steamId]`
6. Run `./scripts/list-server-lobby-names.sh` on each VPS and compare if debugging collisions.

## Scripts

| Script | Purpose |
|--------|---------|
| `verify-vps-instance-config.sh` | Env, processes, Redis ping, instance ID in logs |
| `verify-battle-pipeline.sh` | SSE stream + Redis battle keys + pub/sub channel |
| `list-server-lobby-names.sh` | Export `NAME=` from all `server_cfg.ini` |
| `verify-battle-hud.sh` | Quick SSE smoke test |

See also: [HUD_BATTLE_INTEGRATION.md](./HUD_BATTLE_INTEGRATION.md), [telemetry-data/REDIS_CONTRACT.md](../telemetry-data/REDIS_CONTRACT.md).
