--[[ Version changes arrive via hud_version SSE events — no HTTP poll (/hud/version removed). ]]

local session_version = {}

function session_version.tick(_ctx, _now)
    -- no-op: ac-data pushes hud_version on connect, player_join, lap_completed, etc.
end

return session_version
