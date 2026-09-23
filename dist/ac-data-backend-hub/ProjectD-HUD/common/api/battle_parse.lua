--[[ Map ac-data battle snapshot (SSE) to ProjectD Battle HUD UI model. ]]

local util = require("common.api.util")
local steam = require("common.api.steam")
local battle_players = require("common.api.battle.battle_players")
local battle_terminal = require("common.api.battle.battle_terminal")
local battle_phases = require("common.api.battle.battle_phases")
local battle_trace = require("common.api.battle_trace")

local battle_parse = {}

local PREP_STATES = {
    pairing = true,
    arming = true,
    armed = true,
    launching = true,
}

local DEFAULT_DISAPPEAR_GAP_M = 250

function battle_parse.placeholder_opponent()
    return battle_players.placeholder_opponent()
end

local function format_point_label(entry, local_steam_id)
    if entry == nil or type(entry) ~= "table" then return "" end
    local label = util.safe_str(entry.label)
    if label ~= "" then return label end

    local reason = battle_terminal.format_reason_code(entry.reason or entry.type or entry.event)
    if reason == "" then return "" end

    local points = tonumber(entry.points)
    if points == nil and entry.point ~= nil then
        points = tonumber(entry.point)
    end

    if points ~= nil and points > 0 then
        return reason .. " +" .. tostring(points)
    end
    return reason
end

local function raw_event_label(raw, last_event, local_steam_id)
    local direct = util.safe_str(raw.eventLabel or raw.event_label or raw.statusLabel or raw.status_label)
    if direct ~= "" then
        return battle_terminal.format_reason_code(direct)
    end

    local from_event = format_point_label(last_event, local_steam_id)
    if from_event ~= "" then return from_event end

    local status = string.lower(util.safe_str(raw.status))
    if status ~= "" and status ~= "active" and status ~= "idle" and status ~= "arming" and status ~= "armed" then
        return battle_terminal.format_reason_code(status)
    end
    if status == "idle" then
        return "IDLE"
    end

    return ""
end

local function parse_points_log(raw, local_steam_id)
    local log = raw.pointsLog or raw.points_log
    if type(log) ~= "table" then return {} end

    local entries = {}
    for i = 1, #log do
        if type(log[i]) == "table" then entries[#entries + 1] = log[i] end
    end
    if #entries == 0 then
        for _, entry in pairs(log) do
            if type(entry) == "table" then entries[#entries + 1] = entry end
        end
    end
    if #entries == 0 then return {} end

    local seen_seq = {}
    local deduped = {}
    for i = 1, #entries do
        local entry = entries[i]
        local seq = tonumber(entry.seq)
        if seq ~= nil then
            if seen_seq[seq] then
                goto continue
            end
            seen_seq[seq] = true
        end
        deduped[#deduped + 1] = entry
        ::continue::
    end

    local out = {}
    local start = math.max(1, #deduped - 2)
    for i = start, #deduped do
        local label = format_point_label(deduped[i], local_steam_id)
        if label ~= "" then out[#out + 1] = label end
    end
    return out
end

local function resolve_last_event(raw)
    local last_event = raw.lastEvent or raw.last_event
    if type(last_event) == "table" then return last_event end
    local log = raw.pointsLog or raw.points_log
    if type(log) == "table" and #log > 0 and type(log[#log]) == "table" then
        return log[#log]
    end
    return nil
end

local function event_ts_from_entry(entry)
    if entry == nil then return 0 end
    local ts = tonumber(entry.ts) or tonumber(entry.at) or 0
    if ts > 1e11 then
        return ts / 1000
    end
    return ts
end

local function terminal_display_text(raw, state_name, status_name, _last_event, _local_steam_id)
    return battle_terminal.terminal_center_text(raw, state_name, status_name)
end

function battle_parse.resolve_winner_display(ui)
    return battle_players.resolve_winner_display(ui)
end

function battle_parse.build_display(ui)
    return battle_phases.build_display(ui, battle_players.resolve_winner_display)
end

function battle_parse.attach_display(ui)
    return battle_phases.attach_display(ui, battle_players.resolve_winner_display)
end

function battle_parse.synthesize_end_ui(from_ui, reason_label)
    local ui = battle_terminal.synthesize_end_ui(
        from_ui,
        reason_label,
        battle_parse.deep_copy_ui,
        battle_parse.is_terminal_ui
    )
    if ui == nil then return nil end
    return battle_parse.attach_display(ui)
end

function battle_parse.synthesize_finished_ui(from_ui)
    local ui = battle_terminal.synthesize_finished_ui(
        from_ui,
        battle_parse.deep_copy_ui,
        battle_parse.is_terminal_ui
    )
    if ui == nil then return nil end
    return battle_parse.attach_display(ui)
end

function battle_parse.has_decisive_scores(ui)
    if ui == nil then return false end
    local sl = tonumber(ui.score_left) or 0
    local sr = tonumber(ui.score_right) or 0
    return sl ~= sr
end

function battle_parse.merge_player_ui(incoming, existing)
    return battle_players.merge_player_ui(incoming, existing)
end

function battle_parse.merge_players_from_previous(ui, prev_ui)
    return battle_players.merge_players_from_previous(ui, prev_ui)
end

function battle_parse.is_terminal_ui(ui)
    return battle_terminal.is_terminal_ui(ui)
end

function battle_parse.is_terminal_raw(raw)
    return battle_terminal.is_terminal_raw(raw)
end

function battle_parse.lobby_from_profile(player_profile, _ctx)
    local ui = battle_players.lobby_from_profile(player_profile)
    return battle_parse.attach_display(ui)
end

function battle_parse.lobby_connecting_from_profile(player_profile, _ctx)
    local ui = battle_players.lobby_connecting_from_profile(player_profile)
    return battle_parse.attach_display(ui)
end

function battle_parse.result_hold_sec(ui)
    return battle_terminal.result_hold_sec(ui)
end

function battle_parse.start_result_hold(now, ui)
    return battle_terminal.start_result_hold(now, ui)
end

function battle_parse.to_ui(raw, local_steam_id)
    if raw == nil or type(raw) ~= "table" then return nil end

    local state_name = string.lower(util.safe_str(raw.state or raw.battleState or raw.battle_state))
    if state_name == "" or state_name == "none" or state_name == "idle" then
        if raw.ok == true and (raw.player1 ~= nil or raw.player2 ~= nil) then
            state_name = "pairing"
        else
            return nil
        end
    end

    local status_name = string.lower(util.safe_str(raw.status))
    local local_player, opponent = battle_players.resolve_sides(raw, local_steam_id)
    local is_terminal = battle_parse.is_terminal_raw(raw)
    local looking = not is_terminal and battle_players.opponent_missing(opponent)
    if looking then
        opponent = battle_parse.placeholder_opponent()
    elseif is_terminal and battle_players.opponent_missing(opponent) then
        opponent = {
            name = "?",
            tier = 0,
            avatar_url = nil,
            car_name = "",
            car_id = "",
            role = "",
            steam_id = "",
            score = 0,
        }
    end

    battle_players.reconcile_scores_from_points_log(local_player, opponent, raw, local_steam_id)

    local last_event = resolve_last_event(raw)
    local event_ts = event_ts_from_entry(last_event)
    local end_label = util.safe_str(raw.endLabel or raw.end_label)
    local gap = battle_phases.parse_gap(raw, local_player, DEFAULT_DISAPPEAR_GAP_M)
    local is_active = state_name == "active"
    local is_armed = state_name == "armed"
    local is_draw = status_name == "draw"
    local points_log = parse_points_log(raw, local_steam_id)
    local arming_cd = battle_phases.arming_countdown_sec(raw)
    local arm_proximity_since = battle_phases.arm_proximity_since(raw)

    local center = battle_phases.center_text_for(
        state_name,
        status_name,
        arming_cd,
        local_player,
        looking,
        raw,
        last_event,
        local_steam_id,
        terminal_display_text
    )

    local event_label = ""
    if is_terminal then
        event_label = battle_terminal.terminal_toast_text(
            raw, state_name, status_name, last_event, local_steam_id, format_point_label
        )
        if event_label == center then
            event_label = ""
        end
    elseif is_active or is_armed or state_name == "launching" then
        event_label = raw_event_label(raw, last_event, local_steam_id)
        if event_label == "" and #points_log > 0 then
            event_label = points_log[#points_log]
        end
    end

    local resolved_winner = battle_players.winner_name(raw, local_player, looking and nil or opponent)
    local winner_player = battle_players.winner_player_for_name(
        resolved_winner, local_player, looking and nil or opponent
    )
    local final_score = util.safe_str(raw.finalScoreText or raw.final_score_text)
    if final_score == "" and is_terminal and not looking then
        final_score = string.format(
            "%d-%d",
            tonumber(local_player.score) or 0,
            looking and 0 or (tonumber(opponent.score) or 0)
        )
    end

    local ui = {
        state = state_name,
        status = status_name,
        looking_for_opponent = looking,
        center_text = center,
        mode = center,
        score_left = tonumber(local_player.score) or 0,
        score_right = looking and 0 or (tonumber(opponent.score) or 0),
        player_left = battle_players.player_ui_fields(local_player),
        player_right = battle_players.player_ui_fields(opponent),
        arming_countdown = arming_cd,
        arm_proximity_since = arm_proximity_since,
        countdown_hint = battle_phases.countdown_hint_from_raw(raw),
        event_label = event_label,
        event_ts = event_ts,
        end_label = end_label,
        cancel_reason = util.safe_str(raw.cancelReason or raw.cancel_reason),
        end_reason = util.safe_str(raw.endReason or raw.end_reason),
        finish_gap_m = tonumber(raw.finishGapM or raw.finish_gap_m),
        position_fallback = raw.positionFallback == true or raw.position_fallback == true,
        winner_name = resolved_winner,
        winner_player = winner_player ~= nil and battle_players.player_ui_fields(winner_player) or nil,
        final_score_text = final_score ~= "" and final_score or nil,
        show_gap = (is_active or is_armed) and not looking,
        show_scores = is_active,
        show_prep_scores = state_name == "armed" and not looking,
        gap = gap,
        gap3d_m = gap.current,
        disappear_gap_m = gap.max,
        battle_id = util.safe_str(raw.battleId),
        version = util.safe_str(raw.version),
        revision = tonumber(raw.revision),
        points_log = points_log,
        is_prep = PREP_STATES[state_name] == true,
        is_lobby = false,
    }

    local battle_id = util.safe_str(ui.battle_id)
    if not is_terminal and not battle_players.opponent_missing(opponent) then
        ui.looking_for_opponent = false
        ui.show_gap = (is_active or is_armed)
        ui.show_prep_scores = state_name == "armed"
    elseif battle_id ~= "" and not is_terminal and not battle_players.opponent_missing(opponent) then
        ui.looking_for_opponent = false
        ui.show_gap = (is_active or is_armed)
        ui.show_prep_scores = state_name == "armed"
    end

    ui = battle_parse.attach_display(ui)
    battle_trace.log_trace("PARSED", string.format(
        "battleId=%s state=%s is_lobby=%s looking=%s show_scores=%s score=%s",
        util.safe_str(ui.battle_id),
        util.safe_str(ui.state),
        tostring(ui.is_lobby == true),
        tostring(ui.looking_for_opponent == true),
        tostring(ui.show_scores == true),
        battle_trace.ui_score(ui)
    ))
    return ui
end

function battle_parse.deep_copy_ui(ui)
    if ui == nil then return nil end
    local out = {}
    for k, v in pairs(ui) do
        if type(v) == "table" then
            local inner = {}
            for k2, v2 in pairs(v) do
                inner[k2] = v2
            end
            out[k] = inner
        else
            out[k] = v
        end
    end
    return out
end

return battle_parse
