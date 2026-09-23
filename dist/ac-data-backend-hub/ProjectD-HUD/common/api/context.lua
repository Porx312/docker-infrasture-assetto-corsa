--[[ AC session context: track, car, server name, steam id. ]]

local state = require("common.api.state")
local util = require("common.api.util")
local steam = require("common.api.steam")

local context = {}

local function read_track_full_id()
    if ac.getTrackFullID == nil then return "" end
    for _, sep in ipairs({ "|||", "-", "[]" }) do
        local full_id = util.safe_str(util.safe_call(function() return ac.getTrackFullID(sep) end))
        if full_id ~= "" then return full_id end
    end
    return ""
end

local function parse_track_full_id(full_id)
    full_id = util.safe_str(full_id)
    if full_id == "" then return "", "" end

    local base, layout = full_id:match("^([^|]+)|+(.+)$")
    if base ~= nil and layout ~= nil and layout ~= "" then
        return base, layout
    end

    base, layout = full_id:match("^([^%-]+)%-(.+)$")
    if base ~= nil and layout ~= nil and layout ~= "" then
        return base, layout
    end

    base, layout = full_id:match("^([^%[]+)%[(.+)%]$")
    if base ~= nil and layout ~= nil and layout ~= "" then
        return base, layout
    end

    return full_id, ""
end

local function sim_server_name_sources(sim)
    local raw = {}
    local function add(value)
        value = util.trim_server_name(value)
        if value ~= "" then raw[#raw + 1] = value end
    end
    if sim ~= nil then
        for _, key in ipairs({ "serverName", "onlineServerName", "acOnlineServerName" }) do
            add(util.safe_call(function() return sim[key] end))
        end
    end
    if ac.getServerName ~= nil then
        add(util.safe_call(ac.getServerName))
    end
    return raw
end

function context.is_online_session(sim)
    sim = sim or util.safe_call(function() return ac.getSim() end)
    if sim ~= nil then
        if util.safe_call(function() return sim.isOnlineRace end) == true then return true end
        if util.safe_call(function() return sim.isServerRace end) == true then return true end
        if util.safe_call(function() return sim.isOnlineEvent end) == true then return true end
    end
    if ac.isOnlineRace ~= nil and util.safe_call(ac.isOnlineRace) == true then return true end
    return steam.get_race_ini_status().remote_active
end

local function read_server_name(sim)
    local override = util.trim_server_name(state.server_override_storage:get())
    if override ~= "" then return override end

    if context.is_online_session(sim) then
        for _, name in ipairs(sim_server_name_sources(sim)) do
            if name ~= "" then return name end
        end
    end

    local display = steam.server_display_name_raw()
    if display ~= "" then return display end

    for _, name in ipairs(sim_server_name_sources(sim)) do
        if name ~= "" then return name end
    end

    return steam.server_name_from_race_ini()
end

function context.read_session_context()
    local sim = util.safe_call(function() return ac.getSim() end)
    local full_id = read_track_full_id()

    local track_id = util.safe_str(util.safe_call(function() return ac.getTrackID() end))
    local layout_id = util.safe_str(util.safe_call(function() return ac.getTrackLayout() end))

    if track_id == "" and full_id ~= "" then
        track_id, layout_id = parse_track_full_id(full_id)
    elseif layout_id == "" and full_id ~= "" then
        local parsed_track, parsed_layout = parse_track_full_id(full_id)
        if track_id == "" then track_id = parsed_track end
        if layout_id == "" then layout_id = parsed_layout end
    end

    track_id, layout_id = util.split_track_and_layout(track_id, layout_id)

    return {
        track_id = track_id,
        track_name = util.safe_str(util.safe_call(function() return ac.getTrackName() end)),
        layout_id = layout_id,
        layout_name = layout_id,
        car_id = util.safe_str(util.safe_call(function() return ac.getCarID(0) end)),
        car_name = util.safe_str(util.safe_call(function() return ac.getCarName(0) end)),
        player_steam_id = steam.read_player_steam_id(sim),
        server_name = read_server_name(sim),
        track_full_id = full_id,
        is_online = context.is_online_session(sim),
    }
end

function context.context_is_ready(ctx)
    return ctx ~= nil and steam.normalize_steam_id(ctx.player_steam_id) ~= ""
end

function context.battle_context_ready(ctx)
    return ctx ~= nil and steam.normalize_steam_id(ctx.player_steam_id) ~= ""
end

return context
