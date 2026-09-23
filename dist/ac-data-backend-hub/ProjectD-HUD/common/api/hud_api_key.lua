--[[ Resolve HUD API key: ac.storage override, then config.HUD_API_KEY. ]]

local config = require("common.config")
local util = require("common.api.util")

local STORAGE = ac.storage("ProjectD-HUD:api_key", "")

local hud_api_key = {}

function hud_api_key.resolve()
    local from_storage = util.safe_str(STORAGE:get())
    if from_storage ~= "" then
        return from_storage
    end
    return util.safe_str(config.HUD_API_KEY or "")
end

function hud_api_key.query_suffix()
    local key = hud_api_key.resolve()
    if key == "" then return "" end
    return "&api_key=" .. util.url_encode(key)
end

return hud_api_key
