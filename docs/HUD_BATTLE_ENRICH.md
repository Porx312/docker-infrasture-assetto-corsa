# HUD battle profile enrich (join + push-only)

Battle enrich no longer calls Convex proactively. Profile data comes from **join cache** (`getPlayerJoinContext` on `player_join`) and mid-session updates via **Convex webhooks** (`notifyAcDataHudRefresh`).

## Flow

```text
player_join (every player — HUD or not)
  → getPlayerJoinContext (1× per join, deduped 5s)
  → if player_not_connected (live_players race): 1 retry after HUD_JOIN_CONTEXT_RETRY_MS
  → ac:hud:session + ac:hud:player (TTL ~300s — reused across all battles in session)

battle poll / WSS push
  → Redis ac:hud:battle:*
  → enrichBattleWithProfiles → peekSessionCache only (never Convex)
  → cache miss → snapshot fields from telemetry (AC name, car, score); log source=miss

battle_finished (ac-data)
  → optional battle WSS repush from Redis (no getHudSession)
  → ELO update → ProjectD notifyAcDataHudRefresh reason=battle_elo

cosmetics change
  → notifyAcDataHudRefresh reason=cosmetics → getHudSession (allowlist)
```

## Env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `HUD_PLAYER_TTL_SEC` | **300** | Player cache TTL (aligned with session) |
| `HUD_SESSION_TTL_SEC` | 300 | Session cache TTL |
| `HUD_PLAYER_NOT_CONNECTED_TTL_SEC` | 4 | Short negative cache for rival not in Convex live_players |
| `HUD_JOIN_CONTEXT_RETRY_MS` | 1500 | One-shot join retry when `getPlayerJoinContext` returns `player_not_connected` |
| `HUD_BATTLE_ENRICH_LOG` | false | Log `[battle-enrich] state=… source=peek\|snapshot\|miss` |
| `HUD_BATTLE_ARMING_PUBLISH_MIN_MS` | 500 | Min interval between arming HUD publishes (telemetry-data) |

See also [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md) for webhook reasons including `battle_elo`.

## Verification

```bash
# ac-data must be running
./scripts/verify-battle-convex-volume.sh
# Expect: fetchHudSession delta <= 0

./scripts/verify-join-push-session.sh [steamId]
# Join refresh + 3 battles → delta 0

HUD_BATTLE_ENRICH_LOG=true  # restart ac-data
tail -f ac-data.log | rg 'battle-enrich|fetchHudSession|source=convex'
# Expect: no fetchHudSession / source=convex during battles
```

## Related

- Battle HUD contract: [`HUD_BATTLE_INTEGRATION.md`](HUD_BATTLE_INTEGRATION.md)
- Push sync: [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md)
- Lap spike audit: [`HUD_GETHUDSESSION_LAP_AUDIT.md`](HUD_GETHUDSESSION_LAP_AUDIT.md)
