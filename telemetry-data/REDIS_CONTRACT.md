# Redis Contract (AC scripts ↔ ac-data bridge ↔ Convex)

The Python AC scripts publish telemetry/battle events into Redis Streams. The
Node.js bridge (`ac-data`) consumes those streams and forwards them to Convex
via direct admin mutations.

## Streams

- `ac:events` (configurable via `REDIS_STREAM_KEY`) — runtime telemetry +
  battle results, produced by the Python script and consumed by `ac-data`.
- `ac:config` (configurable via `REDIS_CONFIG_STREAM_KEY`) — `server_cfg.ini`
  snapshots produced by `ac-data` (after polling Convex). **ac-data** is the
  sole writer of local INI files and restarts AC processes
  (`redisConfigApplier.ts`). **telemetry-data** consumes the same stream only
  to update in-memory `runtime_config` (server modes + event constraints) via
  `core/redis_config_sync.py`.

Both streams use `XADD` with approximate `MAXLEN` trim
(`REDIS_STREAM_MAXLEN`, default `200000`) so they cannot grow unbounded.

## Stream fields

Each entry contains the same flat fields:

- `event` — logical event type (e.g. `server_status`, `battle_finished`,
  `server_config_snapshot`).
- `eventId` — unique UUID per message (idempotency key).
- `schemaVersion` — schema version string (default `1`).
- `instanceId` — VPS instance (`AC_INSTANCE_ID`).
- `serverName` — readable server name (or `__config__` for snapshot rows).
- `ts` — unix epoch milliseconds.
- `payload` — JSON envelope with the full event.

## Envelope JSON

```json
{
  "eventId": "9ac53f13-e5f3-4c4a-8b0e-48e99295f43b",
  "schemaVersion": "1",
  "event": "battle_finished",
  "serverName": "ProjectD",
  "instanceId": "vps-eu-2",
  "ts": 1778089600000,
  "data": {}
}
```

## Events published into `ac:events`

Generic server lifecycle (`network/event_dispatcher.send_server_event`):

- `player_join`
- `player_leave`
- `lap_completed` — on managed servers with time-attack or **unified** mode (legacy: `type=time-attack`; default when `type` omitted is unified)
- `server_status` (heartbeat every ~15 s; intentional, used for liveness)

Battle events (`network/event_dispatcher.dispatch_battle_webhook`):

- `battle_update` — produced once when the touge series finishes (win or draw).
- `battle_finished` — same payload as the closing `battle_update`, emitted when
  the session ends with `status` `finished` (`winnerSteamId` set) or `draw` (tie,
  no `winnerSteamId`). Cancelled 0-0 sessions are not published.
- Stream `serverName` uses the AC display name (`config_server_name`), not the
  folder slug; `data.serverName` matches that display name.

## Events published into `ac:config`

- `server_config_snapshot` — produced by the Node.js bridge after detecting a
  new `version` in Convex. Consumed by the Python config consumer to update
  `core/runtime_config` (server modes + event constraints) only.

## Worker expectations (Redis → Convex)

- Use `eventId` as dedupe key (idempotency).
- Route by `event`.
- Persist `instanceId`, `serverName`, `ts` next to the domain payload.
- Acknowledge (`XACK`) only after the Convex mutation succeeds.
- Skip / ack-only on `server_config_snapshot` and `server_config_applied` —
  those are consumed by VPS-side workers, not by Convex ingestion.

## Battle HUD keys (live overlay, not streams)

Written by `telemetry-data/network/battle_hud_publisher.py` when
`BATTLE_HUD_ENABLED=true`. Read by `ac-data` for SSE fan-out (`GET /hud/battle/stream`).

| Key | Value | TTL |
|-----|-------|-----|
| `ac:hud:battle:{serverKey}:{steamId}` | JSON snapshot (`state`, scores, `pointsLog`, `gap3dM`, `disappearGapM`, `cancelReason`, `endReason`, `endLabel`, `finishGapM`, `positionFallback`, `lastEvent`, players with `car_id`) | `HUD_BATTLE_TTL_SEC` (default 120); terminal snapshots kept until `HUD_BATTLE_CLEAR_DELAY_SEC` (default 5) before key delete |
| `ac:hud:ver:battle:{serverKey}:{steamId}` | version string (epoch ms) | `HUD_VER_TTL_SEC` (default 3600) |

Redis snapshot players (telemetry): `steamId`, `name`, `car_id`, `score`, optional `role`.

Each SSE `battle:update` enriches players from `ac:hud:player:*` (derived locally from `ac:hud:session:*` profile):
`name`, `tier`, `avatar_url`, `car_name`, `car_id` — profile wins over snapshot; legacy snapshots with `car` are still accepted.

- `serverKey` = `{AC_INSTANCE_ID}_{normalizedDisplayName}` (lowercase, spaces → `_`, hyphens preserved, CM suffix stripped). Example: `vps-eu-2_battle_test`.
- Legacy keys without instance prefix only occur when `AC_INSTANCE_ID` is unset (defaults to `default`).
- Both players in a pair receive the same snapshot under their respective `steamId` keys.
- Pub/sub channel `ac:hud:updates` notifies clients (same as time-attack HUD).
- **ac-data** fan-out vía **SSE** (`GET /hud/battle/stream`) cuando `HUD_SSE_ENABLED=true`.

## HUD SSE presence (battle matchmaking gate)

Written by **ac-data** when the overlay connects to `GET /hud/stream?steamId=…`.
Read by **telemetry-data** when `BATTLE_REQUIRE_HUD_SSE=true` to gate matchmaking.

| Key | Writer | Reader | TTL |
|-----|--------|--------|-----|
| `ac:hud:sse:{steamId}` | ac-data (`hudSsePresence.ts`) on SSE connect; renewed on keepalive; deleted on disconnect | telemetry-data `core/hud_sse_presence.py` | `HUD_SSE_PRESENCE_TTL_SEC` (default 45) |

Env: `BATTLE_REQUIRE_HUD_SSE` (default false), `HUD_SSE_PRESENCE_TTL_SEC`, `HUD_SSE_REDIS_PREFIX`.

## User invalidation / global ban (not streams)

When Convex marks a profile `isInvalidated`, **ac-data** persists ban state in Redis and
publishes a kick signal. **telemetry-data** reads the same keys (no Convex query in Python).

**Writer path:** on `player_join`, ac-data calls `workerPlayers:getPlayerJoinContext`
(`CONVEX_PLAYER_JOIN_QUERY`) once — user `isInvalidated` + optional HUD `session` (player
cache `ac:hud:player:*` is derived locally from `session.profile`) — then
`markUserInvalidated` when applicable. See [`docs/CONVEX_PLAYER_JOIN_CONTEXT.md`](../docs/CONVEX_PLAYER_JOIN_CONTEXT.md).

| Key / channel | Writer | Reader | TTL |
|---------------|--------|--------|-----|
| `ac:user:invalidated:{steamId}` | ac-data (`hudUserInvalidation.ts`) | telemetry-data on connect (after deferred `player_join` refresh) | `USER_INVALIDATED_TTL_SEC` (default 86400) |
| Pub/sub `ac:user:invalidated` | ac-data on mark | telemetry-data subscriber → kick on all servers | — |

On every `NEW_CONNECTION`, telemetry emits `player_join` **before** ban kick so ac-data can call Convex and run `clearUserInvalidated` when the user was re-validated. Kick is deferred (`USER_BAN_DEFER_POLL_MS` × `USER_BAN_DEFER_ATTEMPTS`) while ac-data refreshes Redis.

Enforcement reads **only** `ac:user:invalidated:{steamId}` (not HUD player cache).

Both ban and registration kicks: **one private chat warning** (`ACSP` 202 to `car_id`), wait
`USER_KICK_WARN_DELAY_SEC` (default 3s), then **one** `KICK_USER` packet. Deduped per connection
(no retries, no `/kick_id` duplicate, no CAR_UPDATE spam).

Env: `USER_BAN_ENABLED`, `USER_INVALIDATED_REDIS_PREFIX`, `USER_INVALIDATED_CHANNEL`,
`USER_INVALIDATED_KICK_MESSAGE`, `USER_KICK_WARN_DELAY_SEC`, `USER_BAN_DEFER_POLL_MS`, `USER_BAN_DEFER_ATTEMPTS`.

Verify: `./scripts/verify-user-ban.sh [steamId]`

## User registration required (not streams)

When Convex returns `user_not_found` (Steam ID not linked to a ProjectD account), **ac-data**
persists registration state in Redis. **telemetry-data** kicks after a private chat warning.

**Writer path:** same `player_join` → `getPlayerJoinContext` flow as bans; `markUserNotRegistered`
when `reason === user_not_found`. Ban state takes precedence (invalidated users get the ban message).

| Key / channel | Writer | Reader | TTL |
|---------------|--------|--------|-----|
| `ac:user:not_registered:{steamId}` | ac-data (`hudUserNotRegistered.ts`) | telemetry-data on connect (after deferred `player_join` refresh) | `USER_NOT_REGISTERED_TTL_SEC` (default 86400) |
| Pub/sub `ac:user:not_registered` | ac-data on mark | telemetry-data subscriber → kick on all servers | — |

On every `NEW_CONNECTION`, telemetry emits `player_join` **before** registration kick so ac-data
can call Convex and run `clearUserNotRegistered` when the user registers. Kick is deferred
(`USER_BAN_DEFER_POLL_MS` × `USER_BAN_DEFER_ATTEMPTS`) while ac-data refreshes Redis.

Uses the same warn-then-kick flow as bans (see above).

Env: `USER_REGISTRATION_REQUIRED`, `USER_NOT_REGISTERED_REDIS_PREFIX`, `USER_NOT_REGISTERED_CHANNEL`,
`USER_NOT_REGISTERED_KICK_MESSAGE`, `USER_KICK_WARN_DELAY_SEC`.

Verify: `./scripts/verify-user-registration-pipeline.sh [steamId]`

## User profile prefs (`saveTime`, `acceptBattle`)

Convex profile fields (default **true** when missing) mirrored to Redis on `player_join` for
fast worker reads. See [`docs/CONVEX_USER_PREFS.md`](../docs/CONVEX_USER_PREFS.md).

| Key | Writer | Reader | Value when disabled |
|-----|--------|--------|---------------------|
| `ac:user:prefs:save_time:{steamId}` | ac-data (`hudUserPrefs.ts`) | ac-data ingest filter (`lap_completed` → skip Convex) | `"0"` (key deleted when enabled) |
| `ac:user:prefs:accept_battle:{steamId}` | ac-data (`hudUserPrefs.ts`) | telemetry-data battle matchmaking | `"0"` (key deleted when enabled) |
| Pub/sub `ac:user:prefs:notify` | ac-data on `acceptBattle` toggle (worker push) | telemetry-data → private chat to player | — |

- **`saveTime=false`**: lap still updates HUD locally; ac-data skips Convex batch ingest for that event
- **`acceptBattle=false`**: player excluded from `_try_matchmake` (drives normally, no pairing)
- **`acceptBattle` toggle** (Convex `refresh-user`): private server chat to that player only (`USER_PREFS_ACCEPT_BATTLE_*_MESSAGE`)

TTL: `USER_PREFS_TTL_SEC` (default 86400), refreshed on each join.

Env: `USER_PREFS_SAVE_TIME_PREFIX`, `USER_PREFS_ACCEPT_BATTLE_PREFIX`, `USER_PREFS_NOTIFY_CHANNEL`, `USER_PREFS_NOTIFY_ENABLED`, `USER_PREFS_ACCEPT_BATTLE_ENABLED_MESSAGE`, `USER_PREFS_ACCEPT_BATTLE_DISABLED_MESSAGE`.

Verify: `./scripts/verify-user-prefs.sh [steamId]`
