# Convex: HUD profile cosmetics (`display_style`, `frame_url`)

Worker sync lives in **assetto-infra** (ac-data + ProjectD-HUD). Convex (ProjectD) owns the source of truth on `session.profile`.

## Fields on `session.profile`

| Field | Type | HUD effect |
|-------|------|------------|
| `display_style` | object | Custom font, color, effect, weight, etc. |
| `frame_url` | string | Avatar frame overlay URL |

ac-data normalizes camelCase and snake_case via `normalizeHudProfile` / `mergeCosmeticFields`.

**Not in scope:** mid-session chat notifications; `profile.name` changes.

## Mid-session update (primary path)

When the user equips a frame or changes display style in the web UI:

1. Convex mutation patches user cosmetics
2. `buildHudSessionForSteamId` rebuilds session with new `display_style` / `frame_url`
3. **Bump `session.version`** (required — ac-data may serve stale Redis without it)
4. Schedule `notifyAcDataHudRefresh` with `reason: "cosmetics"`
5. ac-data `POST /hud/worker/refresh-user` → Redis HUD cache + **live `getHudSession` fetch** + SSE `hud_session`
6. ProjectD-HUD: SSE primary; if no SSE listeners, poll `GET /hud/profile-cosmetics-fp` (Redis-only) and fetch `sections=session` snapshot on change
7. ProjectD-HUD overlay applies new style/frame without reconnect

`player_join` is fallback only (reconnect, webhook failure).

See [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md).

## Convex: wire mutations (ProjectD)

After any mutation that changes `display_style` or equipped frame:

```typescript
const user = await ctx.db.get(userId);
if (user?.steamId) {
  await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataHudRefresh, {
    steamId: user.steamId,
    reason: "cosmetics",
  });
}
```

Examples: equip frame, unequip frame, update display style (font, effect, color).

Requirements in `convex/lib/hudSessionBundle.ts`:

- Include `display_style` and `frame_url` on `session.profile`
- Bump `session.version` when those fields change

## ac-data: cosmetics fingerprint (Redis)

On worker push (`publishEnforcement: true`), ac-data mirrors a stable fingerprint:

| Key | Purpose |
|-----|---------|
| `ac:user:profile:cosmetics_fp:{steamId}` | Last known `display_style` + `frame_url` hash |

Env: `USER_PROFILE_COSMETICS_FP_PREFIX` (default `ac:user:profile:cosmetics_fp:`), TTL `USER_PROFILE_COSMETICS_TTL_SEC` (default 86400).

Log line when changed: `[profile-cosmetics] steamId=… changed=true prev=… next=…`

## Verify

```bash
./scripts/verify-user-cosmetics.sh STEAM_ID
./scripts/verify-push-sync-live.sh STEAM_ID cosmetics   # player connected in-game
```

While connected: change frame/style in web → fingerprint and HUD should update without reconnect.

If manual `verify-push-sync-live.sh cosmetics` works but web does not → Convex webhook not wired.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| HUD unchanged until reconnect | Convex not calling `refresh-user` | Wire mutation + `AC_DATA_BASE_URL` in Convex dashboard |
| Manual refresh works, web does not | Scheduler not deployed | ProjectD `notifyAcDataHudRefresh` on cosmetic mutations |
| refresh-user OK but old cosmetics | `session.version` not bumped | Rebuild HUD session in Convex on cosmetic patch |
| SSE arrives but frame not visible | Client not resetting frame cache | Ensure ProjectD-HUD `appearance_signature` includes `frame_url` |

See also [`CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md), [`CONVEX_PLAYER_JOIN_CONTEXT.md`](CONVEX_PLAYER_JOIN_CONTEXT.md).
