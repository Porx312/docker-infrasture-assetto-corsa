--[[ Resolve WSS URL: hub bootstrap (primary edge, fallback hub proxy). ]]

local hud_bootstrap = require("common.api.hud_bootstrap")
local context = require("common.api.context")

local hud_ws_connect = {}

--- Preferred WebSocket URL for battle/live HUD (call after hud_bootstrap.ensure).
function hud_ws_connect.url(ctx)
    ctx = ctx or context.read_session_context()
    if ctx.is_online ~= true then return "" end
    if not hud_bootstrap.is_ready(ctx) then
        return ""
    end
    return hud_bootstrap.pick_ws_url()
end

function hud_ws_connect.on_ws_error(ctx)
    hud_bootstrap.mark_ws_fallback()
    return hud_bootstrap.pick_ws_url()
end

function hud_ws_connect.ensure(ctx, on_done)
    hud_bootstrap.ensure(ctx, function(ok, reason)
        if not ok then
            on_done(false, reason, "")
            return
        end
        on_done(true, reason, hud_ws_connect.url(ctx))
    end)
end

function hud_ws_connect.reset()
    hud_bootstrap.reset()
end

return hud_ws_connect
