--[[ Paste in CSP App Debug console while in-game on the battle server.
     Enables forensic battle trace logs ([BATTLE_FETCH], [BATTLE_RAW], etc.).

     Sync overlay (required on gaming PC — not the VPS):
       cp -r /path/to/assetto-infra/ProjectD-HUD "Assetto Corsa/apps/lua/ProjectD-HUD"

     Verify config on client (config.lua must match VPS .env.local):
       API_BASE_URL = https://dev-api.projectd.space
       HUD_API_KEY  = (same as HUD_API_KEY in .env.local)

     Enable live API (not mocks):
       ac.storage("ProjectD-HUD:use_api", true):set()

     VPS verify while connected in-game:
       ./scripts/debug-hud-presence.sh
       ./scripts/compare-hud-snapshot-request.sh 76561199230780195 ks_mazda_rx7_spirit_r
       ./scripts/trace-battle-sync.sh path/to/csp-export.log

     CSP log tags to filter (ac.debug export):
       [BATTLE_FETCH]  — HTTP poll start/response
       [BATTLE_RAW]    — battle sub-object before apply
       [BATTLE_REVISION] — stale guard ACCEPT/REJECT
       [BATTLE_TRACE]  — APPLY_IN/OUT, PARSED, RENDER
       [BATTLE_SCORE]  — score transitions
       [BATTLE_RENDER_GATE] — REAL vs LOOKING vs NIL
       [BATTLE_POLL]   — poll tick / skip reasons

     Success during active battle (battle-476c184f179a example):
       [BATTLE_FETCH] status=200 battleOk=true state=active
       [BATTLE_TRACE] stage=APPLY_OUT battle_ui_set=true ui.state=active
       [BATTLE_RENDER_GATE] result=REAL
       [BATTLE_TRACE] stage=RENDER state=active center_key=points
]]

ac.storage("ProjectD-HUD:use_api", true):set()
ac.storage("ProjectD-HUD:battle_debug", true):set()
ac.storage("ProjectD-HUD:battle_sync_trace", true):set()
ac.debug("ProjectD-HUD: forensic trace enabled (battle_debug + battle_sync_trace)")
