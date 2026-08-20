# HUD battle profile enrich (Convex volume)

Battle prep used to trigger ~78 `hud:getHudSession` calls per match: HUD client polls `sections=battle` every 0.3s while telemetry publishes arming snapshots on every `car_update`, and ac-data **enriched** both pilots via `getPlayerCached` → Convex on every poll/push.

## Root cause (fixed in ac-data)

| Issue | Fix |
|-------|-----|
| `player_not_connected` never cached | `HUD_PLAYER_NOT_CONNECTED_TTL_SEC` (default **4s**) negative cache |
| Enrich called Convex on every prep poll/push | **Peek-only enrich** in prep phases (`pairing`–`launching`) |
| Rival profile cold at pair lock | **Pre-warm** both steamIds once on first `pairing` push |
| Arming HUD publish every `car_update` | Throttle to countdown tick or `HUD_BATTLE_ARMING_PUBLISH_MIN_MS` (telemetry) |

## Flow (post-fix)

```text
HUD poll sections=battle (0.3s)
  → Redis ac:hud:battle:*
  → enrichBattleWithProfiles (prep: peekSessionCache only, no Convex)
  → snapshot fields (name, car, score) from Redis if cache miss

pairing push (once per battleId)
  → maybeWarmBattleProfiles → refreshPlayerHudCache ×2 (background)

active / finished
  → getPlayerCached (Convex allowed) for fresh elo/cosmetics
```

## Env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `HUD_PLAYER_NOT_CONNECTED_TTL_SEC` | 4 | Short negative cache for rival not in Convex live_players |
| `HUD_BATTLE_ENRICH_LIVE` | true | When false, peek-only enrich in **all** battle phases |
| `HUD_BATTLE_ENRICH_LOG` | false | Log `[battle-enrich] state=… source=peek\|cache\|convex` |
| `HUD_BATTLE_ARMING_PUBLISH_MIN_MS` | 500 | Min interval between arming HUD publishes (telemetry-data) |

See also [`HUD_TIME_ATTACK_INTEGRATION.md`](HUD_TIME_ATTACK_INTEGRATION.md) for shared HUD cache TTLs.

## Verification

```bash
# ac-data must be running
./scripts/verify-battle-convex-volume.sh
# Expect: fetchHudSession delta <= 4 during simulate-battle-complete --fast

# Optional: enrich trace
HUD_BATTLE_ENRICH_LOG=true  # restart ac-data
tail -f ac-data.log | rg 'battle-enrich|hud-snapshot.*sections=battle'
```

## Related

- Battle HUD contract: [`HUD_BATTLE_INTEGRATION.md`](HUD_BATTLE_INTEGRATION.md)
- Lap spike audit: [`HUD_GETHUDSESSION_LAP_AUDIT.md`](HUD_GETHUDSESSION_LAP_AUDIT.md)
