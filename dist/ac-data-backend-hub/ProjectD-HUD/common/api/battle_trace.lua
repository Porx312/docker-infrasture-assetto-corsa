--[[ Forensic battle HUD trace — gated by ProjectD-HUD:battle_sync_trace or battle_debug. ]]

local util = require("common.api.util")

local DEBUG_STORAGE = ac.storage("ProjectD-HUD:battle_debug", false)
local SYNC_TRACE_STORAGE = ac.storage("ProjectD-HUD:battle_sync_trace", false)

local battle_trace = {}

local request_seq = 0
local poll_skip_last_at = 0
local poll_skip_last_reason = ""
local render_gate_last_at = 0
local render_trace_last_at = 0

local RENDER_THROTTLE_SEC = 0.5
local POLL_SKIP_THROTTLE_SEC = 1.0

function battle_trace.enabled()
    return DEBUG_STORAGE:get() == true or SYNC_TRACE_STORAGE:get() == true
end

function battle_trace.next_request_id()
    request_seq = request_seq + 1
    return request_seq
end

function battle_trace.current_request_id()
    return request_seq
end

function battle_trace.redact_url(url)
    url = util.safe_str(url)
    if url == "" then return "" end
    url = url:gsub("([?&]api_key=)[^&]*", "%1REDACTED")
    url = url:gsub("([?&]x%-api%-key=)[^&]*", "%1REDACTED")
    return url
end

local function emit(tag, msg)
    if not battle_trace.enabled() then return end
    ac.debug("ProjectD-HUD battle_trace", tag .. " " .. util.safe_str(msg))
end

function battle_trace.log(tag, msg)
    emit(tag, msg)
end

local function player_score(raw, key)
    if raw == nil or type(raw) ~= "table" then return "" end
    local p = raw[key]
    if type(p) ~= "table" then return "" end
    return tostring(p.score or "")
end

local function player_name(raw, key)
    if raw == nil or type(raw) ~= "table" then return "" end
    local p = raw[key]
    if type(p) ~= "table" then return "" end
    return util.safe_str(p.name)
end

function battle_trace.battle_fields(raw)
    if raw == nil or type(raw) ~= "table" then
        return "", "", "", "", "", ""
    end
    local rev = raw.revision or raw.snapshotRevision or raw.snapshot_revision
    return util.safe_str(raw.battleId),
        util.safe_str(raw.state),
        rev ~= nil and tostring(rev) or "",
        util.safe_str(raw.version),
        player_name(raw, "player1"),
        player_score(raw, "player1"),
        player_name(raw, "player2"),
        player_score(raw, "player2")
end

function battle_trace.ui_score(ui)
    if ui == nil then return "0-0" end
    return tostring(ui.score_left or 0) .. "-" .. tostring(ui.score_right or 0)
end

function battle_trace.log_fetch_start(request_id, url, steam_id, inflight)
    emit("[BATTLE_FETCH]", string.format(
        "request_id=%s url=%s steamId=%s inflight=%s",
        tostring(request_id),
        battle_trace.redact_url(url),
        util.safe_str(steam_id),
        tostring(inflight or "")
    ))
end

function battle_trace.log_fetch_response(request_id, status, steam_id, raw)
    local top_ok = raw ~= nil and raw.ok
    local battle = raw ~= nil and raw.battle or nil
    local b_ok, b_id, b_st, b_rev, _, p1s, _, p2s = "", "", "", "", "", "", "", ""
    if type(battle) == "table" then
        b_ok = tostring(battle.ok)
        b_id, b_st, b_rev = battle_trace.battle_fields(battle)
        p1s = player_score(battle, "player1")
        p2s = player_score(battle, "player2")
    end
    emit("[BATTLE_FETCH]", string.format(
        "request_id=%s status=%s steamId=%s topOk=%s battleOk=%s battleId=%s state=%s rev=%s p1Score=%s p2Score=%s",
        tostring(request_id),
        tostring(status or ""),
        util.safe_str(steam_id),
        tostring(top_ok),
        b_ok,
        b_id,
        b_st,
        b_rev,
        p1s,
        p2s
    ))
end

function battle_trace.log_raw(request_id, raw)
    if type(raw) ~= "table" then return end
    local b_id, b_st, b_rev, b_ver, p1n, p1s, p2n, p2s = battle_trace.battle_fields(raw)
    emit("[BATTLE_RAW]", string.format(
        "request_id=%s battleId=%s state=%s rev=%s version=%s p1=%s p1Score=%s p2=%s p2Score=%s ok=%s",
        tostring(request_id),
        b_id,
        b_st,
        b_rev,
        b_ver,
        p1n,
        p1s,
        p2n,
        p2s,
        tostring(raw.ok)
    ))
end

function battle_trace.log_poll_skip(reason, now)
    if not battle_trace.enabled() then return end
    now = now or os.clock()
    reason = util.safe_str(reason)
    if reason == poll_skip_last_reason and (now - poll_skip_last_at) < POLL_SKIP_THROTTLE_SEC then
        return
    end
    poll_skip_last_at = now
    poll_skip_last_reason = reason
    emit("[BATTLE_POLL]", "skip reason=" .. reason)
    pcall(function()
        require("common.api.hud_server_trace").log_poll_skip(reason)
    end)
end

function battle_trace.log_poll_tick(request_id, scheduled_in_sec)
    emit("[BATTLE_POLL]", string.format(
        "tick request_id=%s scheduled_in=%.2fs",
        tostring(request_id),
        tonumber(scheduled_in_sec) or 0
    ))
end

function battle_trace.log_revision(fields)
    emit("[BATTLE_REVISION]", fields)
end

function battle_trace.log_trace(stage, msg)
    emit("[BATTLE_TRACE]", "stage=" .. util.safe_str(stage) .. " " .. util.safe_str(msg))
end

function battle_trace.log_score(battle_id, old_score, new_score, revision, transport)
    emit("[BATTLE_SCORE]", string.format(
        "battleId=%s oldScore=%s newScore=%s revision=%s transport=%s",
        util.safe_str(battle_id),
        util.safe_str(old_score),
        util.safe_str(new_score),
        revision ~= nil and tostring(revision) or "",
        util.safe_str(transport)
    ))
end

function battle_trace.log_render_gate(msg)
    if not battle_trace.enabled() then return end
    local now = os.clock()
    if (now - render_gate_last_at) < RENDER_THROTTLE_SEC then return end
    render_gate_last_at = now
    emit("[BATTLE_RENDER_GATE]", msg)
end

function battle_trace.log_render(battle)
    if not battle_trace.enabled() then return end
    local now = os.clock()
    if (now - render_trace_last_at) < RENDER_THROTTLE_SEC then return end
    render_trace_last_at = now
    local display = battle.display or {}
    local center_key = util.safe_str(display.center_key)
    emit("[BATTLE_TRACE]", string.format(
        "stage=RENDER battleId=%s state=%s center_key=%s score=%s is_lobby=%s",
        util.safe_str(battle.battle_id),
        util.safe_str(battle.state),
        center_key,
        battle_trace.ui_score(battle),
        tostring(battle.is_lobby == true)
    ))
end

return battle_trace
