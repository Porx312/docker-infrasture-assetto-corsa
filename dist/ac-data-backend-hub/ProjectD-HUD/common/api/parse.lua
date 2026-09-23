--[[ Session API response parsing (time attack: players[] + profile, no leaderboard). ]]

local state = require("common.api.state")
local util = require("common.api.util")
local steam = require("common.api.steam")
local profile = require("common.api.profile")

local parse = {}

local function set_parse_error(reason)
    reason = tostring(reason or "")
    if reason == "" then return end
    if util.should_ignore_error(reason) then return end
    if util.is_presence_fatal(reason) then
        util.apply_presence_error(reason)
        return
    end
    state.last_error = reason
end

local function iter_players(players)
    local list = {}
    if players == nil or type(players) ~= "table" then return list end
    for _, player in ipairs(players) do
        list[#list + 1] = player
    end
    if #list == 0 then
        for _, player in pairs(players) do
            if type(player) == "table" then
                list[#list + 1] = player
            end
        end
    end
    return list
end

function parse.response_is_ok(data)
    if data == nil or type(data) ~= "table" then return false end
    if data.error ~= nil then return false end
    if data.ok == false then return false end
    if data.ok == true then return true end
    if data.players ~= nil then return true end
    if data.profile ~= nil then return true end
    return false
end

function parse.normalize_session_response(data, steam_id)
    steam_id = steam.normalize_steam_id(steam_id)

    if not parse.response_is_ok(data) then
        if data ~= nil and data.error ~= nil then
            set_parse_error(data.error)
        elseif data ~= nil and data.reason ~= nil then
            set_parse_error(data.reason)
        end
        return nil
    end

    local player_list = iter_players(data.players)
    state.last_session_had_players = #player_list > 0

    local player_profile, player_row = profile.pick_player_profile(data.players, steam_id, data)

    local out = {
        ok = true,
        context = data.context,
        profile = player_profile or profile.coalesce_from_api(data),
    }

    if player_row ~= nil then
        if player_row.context ~= nil then out.context = player_row.context end
        profile.apply_player_lookup_error(player_row, out.profile, steam_id)
    elseif out.profile == nil and data.context ~= nil then
        state.last_error = "profile_unavailable"
    end

    if out.profile ~= nil then
        if out.profile.isInvalidated == true then
            state.last_error = "user_invalidated"
            out.profile = nil
            return nil
        else
            state.last_error = nil
        end
    else
        state.last_error = "profile_unavailable"
        return nil
    end

    return out
end

return parse
