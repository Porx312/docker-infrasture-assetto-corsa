# HUD server switch — manual verification checklist

Run after Gunsai → Battle (or any server switch) without restarting Assetto Corsa.

## Enable debug trace (in-game console)

```lua
ac.storage("ProjectD-HUD:battle_debug", true)
```

## Pre-switch (on Gunsai Testing)

1. Join **Gunsai Testing** online with a linked Steam account.
2. Confirm profile, competition, and battle panels show Gunsai data (not Loading).
3. On VPS/host:
   ```bash
   ./scripts/compare-hud-server-identity.sh YOUR_STEAM_ID gunsai | tee /tmp/hud-gunsai.txt
   ```
4. In AC log / debug overlay, confirm `[HUD_SERVER_IDENTITY]` shows `mismatch=false`.

## Switch (no AC restart)

5. Leave Gunsai and join **Battle** (same Steam ID).
6. Within **5 seconds**, profile/competition/battle should update to Battle context.
7. UI should briefly show **"Updating server data…"** at most once — not infinite **Loading...**.

## Post-switch (on Battle)

8. Run compare script again:
   ```bash
   ./scripts/compare-hud-server-identity.sh YOUR_STEAM_ID battle | tee /tmp/hud-battle.txt
   diff -u /tmp/hud-gunsai.txt /tmp/hud-battle.txt
   ```
9. First diverging row = root cause if still broken.
10. Confirm:
    - `presence.serverName` = Battle (or display name from server_cfg)
    - `context.server_name` in snapshot = Battle
    - `[HUD_SERVER_IDENTITY] mismatch=false`
    - `[HUD_REQUEST]` snapshot/SSE `context_server=Battle`

## Fresh Battle-only connect

11. Restart AC (or use a client that was never on Gunsai).
12. Join Battle only — HUD should load without prior Gunsai session in Redis.
13. `./scripts/compare-hud-server-identity.sh YOUR_STEAM_ID battle-only`

## Backend logs (ac-data)

```bash
grep -E 'hud-snapshot|hud-sse-init|hud-presence.*server changed' ac-data.log | tail -30
```

Expect on server switch:
- `[hud-presence] ... server changed Gunsai Testing -> Battle session cache invalidated`
- `[hud-sse-init] ... bypassCache=true` when reconnecting SSE after switch

## Pass criteria

- [ ] Gunsai loads fully on first connect
- [ ] Battle loads fully after switch within 5s
- [ ] No infinite Loading loop on Battle
- [ ] Compare script: presence and snapshot `context.server_name` match live server
- [ ] Debug trace shows no persistent `mismatch=true`
