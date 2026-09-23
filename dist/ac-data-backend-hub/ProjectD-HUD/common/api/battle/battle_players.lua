--[[ Battle player resolution and merge helpers. ]]

local util = require("common.api.util")
local profile = require("common.api.profile")
local steam = require("common.api.steam")
local display_style = require("common.display_style")

local players = {}

local function parse_elo(p)
    if p == nil or type(p) ~= "table" then return nil end
    return tonumber(p.elo) or tonumber(p.mmr) or tonumber(p.rating)
end

function players.parse_elo(p)
    return parse_elo(p)
end

function players.placeholder_opponent()
    return {
        placeholder = true,
        name = "Looking for opponent",
        car_name = "",
        tier = 0,
        avatar_url = nil,
        role = "",
    }
end

local function parse_ahead_on_track(p)
    if p == nil or type(p) ~= "table" then return nil end
    local raw = p.aheadOnTrack
    if raw == nil then raw = p.ahead_on_track end
    if raw == true then return true end
    if raw == false then return false end
    return nil
end

function players.player_from_api(p)
    if p == nil or type(p) ~= "table" then
        return nil
    end
    local sid = steam.normalize_steam_id(p.steamId or p.steam_id)
    local name = util.safe_str(p.name)
    if sid == "" and name == "" then
        return nil
    end
    local player = {
        name = name ~= "" and name or "?",
        tier = profile.tier_for_display(p),
        avatar_url = profile.avatar_from_raw(p),
        car_name = util.safe_str(p.car_name or p.carName),
        car_id = util.safe_str(p.car_id or p.carId or p.carModel),
        role = string.lower(util.safe_str(p.role)),
        steam_id = sid,
        score = tonumber(p.score) or 0,
        elo = parse_elo(p),
        ahead_on_track = parse_ahead_on_track(p),
    }
    profile.apply_cosmetic_fields(player, p)
    return player
end

local function merge_scalar_stat(incoming, existing, key)
    local inc = incoming[key]
    if key == "tier" then
        if profile.tier_for_display(incoming) > 0 then return inc end
        if profile.tier_for_display(existing) > 0 then return existing[key] end
        return inc
    end
    if key == "elo" then
        local inc_num = inc ~= nil and tonumber(inc) or nil
        if inc_num ~= nil and inc_num > 0 then return inc end
        if existing ~= nil then
            local ex_num = tonumber(existing[key])
            if ex_num ~= nil and ex_num > 0 then return existing[key] end
        end
        return inc
    end
    return inc
end

function players.opponent_missing(opponent)
    if opponent == nil then return true end
    if opponent.placeholder == true then return true end
    if util.safe_str(opponent.steam_id) == "" and util.safe_str(opponent.name) == "" then
        return true
    end
    local name = util.safe_str(opponent.name)
    return name == "" or name == "?"
end

function players.resolve_sides(raw, local_steam_id)
    local p1 = players.player_from_api(raw.player1)
    local p2 = players.player_from_api(raw.player2)
    local me = steam.normalize_steam_id(local_steam_id)

    local local_player, opponent
    if me ~= "" and p1 ~= nil and p1.steam_id == me then
        local_player, opponent = p1, p2
    elseif me ~= "" and p2 ~= nil and p2.steam_id == me then
        local_player, opponent = p2, p1
    elseif p1 ~= nil then
        local_player, opponent = p1, p2
    else
        local_player, opponent = p2, p1
    end

    if local_player == nil then
        local_player = {
            name = "?",
            tier = 0,
            avatar_url = nil,
            car_name = "",
            car_id = "",
            role = "",
            steam_id = me,
            score = 0,
        }
    end

    local s1 = tonumber(raw.player1Score or raw.player1_score)
    local s2 = tonumber(raw.player2Score or raw.player2_score)
    if p1 ~= nil then
        local nested = raw.player1 and tonumber(raw.player1.score)
        if nested ~= nil then p1.score = nested end
        if s1 ~= nil then p1.score = s1 end
    end
    if p2 ~= nil then
        local nested = raw.player2 and tonumber(raw.player2.score)
        if nested ~= nil then p2.score = nested end
        if s2 ~= nil then p2.score = s2 end
    end

    return local_player, opponent
end

local function count_points_for_steam(raw, steam_id)
    steam_id = steam.normalize_steam_id(steam_id)
    if steam_id == "" then return 0 end
    local log = raw.pointsLog or raw.points_log
    if type(log) ~= "table" then return 0 end
    local count = 0
    for i = 1, #log do
        local entry = log[i]
        if type(entry) == "table" then
            local scorer = steam.normalize_steam_id(entry.scorer or entry.scorerSteamId)
            if scorer == steam_id then
                count = count + 1
            end
        end
    end
    return count
end

function players.reconcile_scores_from_points_log(local_player, opponent, raw, local_steam_id)
    if raw == nil or type(raw) ~= "table" then return end
    local me = steam.normalize_steam_id(local_steam_id)
    if local_player ~= nil and me ~= "" then
        local my_count = count_points_for_steam(raw, me)
        local local_score = tonumber(local_player.score) or 0
        if my_count > local_score then
            local_player.score = my_count
        end
    end
    if opponent ~= nil and opponent.placeholder ~= true then
        local opp_id = steam.normalize_steam_id(opponent.steam_id)
        if opp_id ~= "" then
            local opp_count = count_points_for_steam(raw, opp_id)
            local opp_score = tonumber(opponent.score) or 0
            if opp_count > opp_score then
                opponent.score = opp_count
            end
        end
    end
end

local function has_frame_url(player)
    return player ~= nil and util.safe_str(player.frame_url) ~= ""
end

local function merge_cosmetic_field(incoming, existing, key)
    local inc = incoming[key]
    if key == "frame_url" then
        if has_frame_url(incoming) then return inc end
        if has_frame_url(existing) then return existing[key] end
        return inc
    end
    if key == "display_style" then
        if inc ~= nil and display_style.has_custom_display_style(inc) then return inc end
        if existing ~= nil and display_style.has_custom_display_style(existing[key]) then
            return existing[key]
        end
        return nil
    end
    if inc ~= nil then return inc end
    if existing ~= nil then return existing[key] end
    return inc
end

local function has_useful_name(val)
    local s = util.safe_str(val)
    return s ~= "" and s ~= "?"
end

local function has_useful_text(val)
    return util.safe_str(val) ~= ""
end

local function has_useful_avatar(val)
    return val ~= nil and val ~= ""
end

local function is_slug_car_name(name, car_id)
    local s = util.safe_str(name)
    if s == "" then return false end
    local id = util.safe_str(car_id)
    if id ~= "" and s == id then return true end
    if string.find(s, "_") and string.match(s, "^[%w_]+$") and string.match(s, "%u") then
        return true
    end
    return false
end

local function merge_display_field(incoming, existing, key)
    local inc = incoming[key]
    if key == "name" then
        if has_useful_name(inc) then return inc end
        if existing ~= nil and has_useful_name(existing[key]) then return existing[key] end
        return inc
    end
    if key == "avatar_url" then
        if has_useful_avatar(inc) then return inc end
        if existing ~= nil and has_useful_avatar(existing[key]) then return existing[key] end
        return inc
    end
    if key == "car_name" then
        local inc_id = util.safe_str(incoming.car_id)
        local ex_id = existing ~= nil and util.safe_str(existing.car_id) or ""
        local slug_id = inc_id ~= "" and inc_id or ex_id
        if has_useful_text(inc) and not is_slug_car_name(inc, slug_id) then return inc end
        if existing ~= nil and has_useful_text(existing[key]) and not is_slug_car_name(existing[key], ex_id) then
            return existing[key]
        end
        return inc
    end
    if key == "car_id" or key == "steam_id" or key == "role" then
        if has_useful_text(inc) then return inc end
        if existing ~= nil and has_useful_text(existing[key]) then return existing[key] end
        return inc
    end
    return inc
end

local DISPLAY_MERGE_KEYS = { "name", "car_name", "car_id", "avatar_url", "steam_id", "role" }

local function apply_display_merge(p, inc, ex)
    for i = 1, #DISPLAY_MERGE_KEYS do
        local key = DISPLAY_MERGE_KEYS[i]
        p[key] = merge_display_field(inc, ex, key)
    end
end

function players.player_ui_fields(player)
    return {
        name = player.name,
        tier = player.tier,
        avatar_url = player.avatar_url,
        car_name = player.car_name,
        car_id = player.car_id,
        role = player.role,
        elo = player.elo,
        ahead_on_track = player.ahead_on_track,
        steam_id = player.steam_id,
        display_style = player.display_style,
        frame_url = player.frame_url,
        placeholder = player.placeholder == true,
    }
end

local function incoming_is_full_player(incoming)
    if incoming == nil or type(incoming) ~= "table" then return false end
    if incoming.placeholder == true then return true end
    if util.safe_str(incoming.name) ~= "" and util.safe_str(incoming.name) ~= "?" then return true end
    if util.safe_str(incoming.car_name) ~= "" then return true end
    if util.safe_str(incoming.car_id) ~= "" then return true end
    if incoming.avatar_url ~= nil and incoming.avatar_url ~= "" then return true end
    return false
end

function players.merge_player_ui(incoming, existing)
    incoming = incoming or {}
    if incoming.placeholder == true then return incoming end
    if existing == nil or existing.placeholder == true then
        return players.player_ui_fields(incoming)
    end

    local inc = players.player_ui_fields(incoming)
    local ex = players.player_ui_fields(existing)

    if not incoming_is_full_player(incoming) then
        local p = ex
        apply_display_merge(p, inc, ex)
        p.tier = merge_scalar_stat(inc, ex, "tier")
        p.elo = merge_scalar_stat(inc, ex, "elo")
        p.display_style = merge_cosmetic_field(inc, ex, "display_style")
        p.frame_url = merge_cosmetic_field(inc, ex, "frame_url")
        return p
    end

    local p = inc
    apply_display_merge(p, inc, ex)
    p.tier = merge_scalar_stat(inc, ex, "tier")
    p.elo = merge_scalar_stat(inc, ex, "elo")
    p.display_style = merge_cosmetic_field(inc, ex, "display_style")
    p.frame_url = merge_cosmetic_field(inc, ex, "frame_url")
    return p
end

function players.merge_players_from_previous(ui, prev_ui)
    if ui == nil or prev_ui == nil then return ui end
    ui.player_left = players.merge_player_ui(ui.player_left, prev_ui.player_left)
    ui.player_right = players.merge_player_ui(ui.player_right, prev_ui.player_right)
    return ui
end

local function name_for_steam_id(winner_id, raw, local_player, opponent)
    if winner_id == "" then return nil end
    if local_player ~= nil and local_player.steam_id == winner_id then
        return util.safe_str(local_player.name)
    end
    if opponent ~= nil and opponent.steam_id == winner_id then
        return util.safe_str(opponent.name)
    end
    if raw.player1 ~= nil and steam.normalize_steam_id(raw.player1.steamId or raw.player1.steam_id) == winner_id then
        return util.safe_str(raw.player1.name)
    end
    if raw.player2 ~= nil and steam.normalize_steam_id(raw.player2.steamId or raw.player2.steam_id) == winner_id then
        return util.safe_str(raw.player2.name)
    end
    return nil
end

local function winner_name_from_fields(raw)
    local direct = util.safe_str(raw.winnerName or raw.winner_name)
    if direct ~= "" then return direct end

    local winner = raw.winner
    if type(winner) == "string" and winner ~= "" then return winner end
    if type(winner) == "table" then
        local name = util.safe_str(winner.name or winner.displayName or winner.display_name)
        if name ~= "" then return name end
        local wid = steam.normalize_steam_id(winner.steamId or winner.steam_id)
        if wid ~= "" then
            return name_for_steam_id(wid, raw, nil, nil)
        end
    end
    return nil
end

local function winner_name_from_scores(raw, local_player, opponent)
    local p1 = raw.player1
    local p2 = raw.player2
    if type(p1) == "table" and type(p2) == "table" then
        local s1 = tonumber(raw.player1Score or raw.player1_score or p1.score)
        local s2 = tonumber(raw.player2Score or raw.player2_score or p2.score)
        if s1 ~= nil and s2 ~= nil and s1 ~= s2 then
            if s1 > s2 then
                local n = util.safe_str(p1.name)
                if n ~= "" then return n end
            else
                local n = util.safe_str(p2.name)
                if n ~= "" then return n end
            end
        end
    end

    if local_player == nil or opponent == nil then return nil end
    local sl = tonumber(local_player.score) or 0
    local sr = tonumber(opponent.score) or 0
    if sl == sr then return nil end
    if sl > sr then return util.safe_str(local_player.name) end
    return util.safe_str(opponent.name)
end

function players.winner_name(raw, local_player, opponent)
    local from_fields = winner_name_from_fields(raw)
    if from_fields ~= nil and from_fields ~= "" then return from_fields end

    local winner_id = steam.normalize_steam_id(raw.winnerSteamId or raw.winner_steam_id)
    if winner_id ~= "" then
        local by_id = name_for_steam_id(winner_id, raw, local_player, opponent)
        if by_id ~= nil and by_id ~= "" then return by_id end
    end

    return winner_name_from_scores(raw, local_player, opponent)
end

function players.winner_player_for_name(name, local_player, opponent)
    name = util.safe_str(name)
    if name == "" then return nil end
    if local_player ~= nil and util.safe_str(local_player.name) == name then
        return local_player
    end
    if opponent ~= nil and util.safe_str(opponent.name) == name then
        return opponent
    end
    return { name = name }
end

function players.resolve_winner_display(ui)
    if ui == nil then return "" end

    local name = util.safe_str(ui.winner_name)
    if name == "" and type(ui.winner_player) == "table" then
        name = util.safe_str(ui.winner_player.name)
    end
    if name ~= "" then return name end

    local sl = tonumber(ui.score_left) or 0
    local sr = tonumber(ui.score_right) or 0
    if sl ~= sr then
        if sl > sr and ui.player_left ~= nil and ui.player_left.placeholder ~= true then
            name = util.safe_str(ui.player_left.name)
            if name ~= "" then return name end
        end
        if sr > sl and ui.player_right ~= nil and ui.player_right.placeholder ~= true then
            name = util.safe_str(ui.player_right.name)
            if name ~= "" then return name end
        end
    end

    return ""
end

function players.lobby_from_profile(player_profile)
    player_profile = player_profile or {}
    local name = util.safe_str(player_profile.name)
    local left = {
        name = name ~= "" and name or "?",
        tier = profile.tier_for_display(player_profile),
        avatar_url = player_profile.avatar_url,
        car_name = util.safe_str(player_profile.car_name),
        car_id = util.safe_str(player_profile.car_id),
        role = "",
        elo = parse_elo(player_profile),
        steam_id = steam.normalize_steam_id(player_profile.steam_id or player_profile.steamId),
    }
    profile.apply_cosmetic_fields(left, player_profile)
    return {
        state = "pairing",
        status = "idle",
        looking_for_opponent = true,
        center_text = "LOOKING",
        mode = "LOOKING",
        score_left = 0,
        score_right = 0,
        show_scores = false,
        show_gap = false,
        player_left = left,
        player_right = players.placeholder_opponent(),
        event_label = "",
        event_ts = 0,
        points_log = {},
        is_lobby = true,
    }
end

function players.lobby_connecting_from_profile(player_profile)
    local ui = players.lobby_from_profile(player_profile)
    ui.center_text = "CONNECTING"
    ui.mode = "CONNECTING"
    ui.looking_for_opponent = true
    return ui
end

return players
