--[[ Facade: API live data or mocks for offline dev. ]]

local storage = ac.storage("ProjectD-HUD:use_api", true)

local mock_mod
local api_mod
local api_load_err

local function wants_api()
    return storage:get() == true
end

local function mock_backend()
    if mock_mod == nil then
        mock_mod = require("common.mock_data")
    end
    return mock_mod
end

local function load_api(force_retry)
    if force_retry then
        api_mod = nil
        api_load_err = nil
    end
    if api_mod ~= nil then return api_mod end

    local ok, mod = pcall(require, "common.api_data")
    if ok then
        api_mod = mod
        api_load_err = nil
        return api_mod
    end

    api_load_err = tostring(mod)
    ac.debug("ProjectD-HUD api_data failed", api_load_err)
    return nil
end

--- When use_api is on but the API module is unavailable, never fall back to mock data.
local empty_backend = {
    fetch_session = function() end,
    tick = function() end,
    init = function() end,
    reset_session_state = function() end,
    is_account_restricted = function() return false end,
    is_loading = function() return false end,
    get_player_profile = function() return nil end,
    get_competition_ladder = function()
        return { slots = {}, player_rank = 0, profile = nil }
    end,
    get_battle = function() return nil end,
    get_context = function() return {} end,
    get_status = function() return {} end,
}

local function backend()
    if wants_api() then
        local api = load_api(false)
        if api ~= nil then return api end
        return empty_backend
    end
    return mock_backend()
end

local function api_error_status(kind)
    if not wants_api() or api_load_err == nil then return nil end
    if kind == "leaderboard" or kind == "profile" or kind == "competition" then
        return "HUD API error — reinstall full ProjectD-HUD folder"
    end
    return api_load_err
end

local data = {}

function data.get_status_message(kind)
    if wants_api() and load_api(false) == nil then
        return api_error_status(kind)
    end
    local fn = backend().get_status_message
    if fn == nil then return nil end
    return fn(kind)
end

function data.init()
    local mod = backend()
    if mod.init ~= nil then mod.init() end
end

function data.on_session_start()
    if wants_api() then
        load_api(true)
    end
    local mod = backend()
    if mod.on_session_start ~= nil then mod.on_session_start() end
end

function data.tick(car_filter)
    local mod = backend()
    if mod.tick ~= nil then mod.tick(car_filter) end
end

setmetatable(data, {
    __index = function(_, key)
        return backend()[key]
    end,
})

return data
