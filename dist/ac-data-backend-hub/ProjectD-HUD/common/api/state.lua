--[[ Shared mutable HUD state — one instance for all windows. ]]

local STATE_KEY = "__ProjectDHudSharedState_v1"

local function create_state()
    local state = {
        last_tick_at = -1,
        tick_count = 0,
        TICK_INTERVAL_SEC = 0.12,
        steam_override_storage = ac.storage("ProjectD-HUD:steam_id", ""),
        steam_cache_storage = ac.storage("ProjectD-HUD:steam_cache", ""),
        server_override_storage = ac.storage("ProjectD-HUD:server_name", ""),
    }

    for key, value in pairs(require("common.api.state.session")) do
        state[key] = value
    end
    for key, value in pairs(require("common.api.state.web")) do
        state[key] = value
    end
    for key, value in pairs(require("common.api.state.transport")) do
        state[key] = value
    end
    for key, value in pairs(require("common.api.state.battle")) do
        state[key] = value
    end

    return state
end

local shared_root = (ac ~= nil and ac.shared) or _G
if shared_root[STATE_KEY] == nil then
    shared_root[STATE_KEY] = create_state()
end

local state = shared_root[STATE_KEY]

function state.state_tag()
    return string.sub(tostring(state), -8)
end

return state
