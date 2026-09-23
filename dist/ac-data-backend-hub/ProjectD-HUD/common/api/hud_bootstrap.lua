--[[ Fetch hub /hud/bootstrap once per online session — direct edge WSS + hub fallback. ]]

local util = require("common.api.util")
local state = require("common.api.state")
local hud_api_key = require("common.api.hud_api_key")
local context = require("common.api.context")

local hud_bootstrap = {}

local function load_config()
    local ok, cfg = pcall(require, "common.config")
    if ok and cfg ~= nil then return cfg end
    return {
        API_BASE_URL = "",
        HUD_BOOTSTRAP_PATH = "/hud/bootstrap",
    }
end

local function bootstrap_cache_key(ctx)
    ctx = ctx or context.read_session_context()
    local steam = util.safe_str(ctx.player_steam_id)
    local server = util.safe_str(ctx.server_name)
    return steam .. "|" .. server
end

function hud_bootstrap.reset()
    state.ws_primary_url = ""
    state.ws_fallback_url = ""
    state.ws_using_fallback = false
    state.bootstrap_instance_id = ""
    state.bootstrap_ok = false
    state.bootstrap_at = 0
    state.bootstrap_fetched_for = ""
    state.bootstrap_inflight = false
end

local function apply_bootstrap_json(data, ctx)
    if data == nil or data.ok ~= true or type(data.ws) ~= "table" then
        return false
    end
    state.ws_primary_url = util.safe_str(data.ws.primary)
    state.ws_fallback_url = util.safe_str(data.ws.fallback)
    state.ws_using_fallback = false
    state.bootstrap_instance_id = util.safe_str(data.instanceId)
    state.bootstrap_ok = state.ws_primary_url ~= "" or state.ws_fallback_url ~= ""
    state.bootstrap_at = os.clock()
    state.bootstrap_fetched_for = bootstrap_cache_key(ctx)
    return state.bootstrap_ok
end

function hud_bootstrap.pick_ws_url()
    if state.ws_using_fallback and state.ws_fallback_url ~= "" then
        return state.ws_fallback_url
    end
    if state.ws_primary_url ~= "" then
        return state.ws_primary_url
    end
    return state.ws_fallback_url
end

function hud_bootstrap.mark_ws_fallback()
    state.ws_using_fallback = true
end

function hud_bootstrap.is_ready(ctx)
    ctx = ctx or context.read_session_context()
    if ctx.is_online ~= true then return false end
    return state.bootstrap_ok
        and state.bootstrap_fetched_for == bootstrap_cache_key(ctx)
end

function hud_bootstrap.build_url(ctx)
    ctx = ctx or context.read_session_context()
    local cfg = load_config()
    local base = util.safe_str(cfg.API_BASE_URL)
    if base == "" then return "" end
    base = base:gsub("/+$", "")
    local path = util.safe_str(cfg.HUD_BOOTSTRAP_PATH)
    if path == "" then path = "/hud/bootstrap" end
    if path:sub(1, 1) ~= "/" then path = "/" .. path end

    local qs = {}
    local steam = util.safe_str(ctx.player_steam_id)
    local server = util.safe_str(ctx.server_name)
    if steam ~= "" then qs[#qs + 1] = "steamId=" .. util.url_encode(steam) end
    if server ~= "" then qs[#qs + 1] = "serverName=" .. util.url_encode(server) end
    local key_qs = hud_api_key.query_suffix()
    if key_qs ~= "" then
        qs[#qs + 1] = key_qs:gsub("^&", "")
    end
    local query = table.concat(qs, "&")
    if query == "" then return base .. path end
    return base .. path .. "?" .. query
end

function hud_bootstrap.ensure(ctx, on_done)
    ctx = ctx or context.read_session_context()
    on_done = on_done or function() end

    if ctx.is_online ~= true then
        on_done(false, "offline")
        return
    end
    if hud_bootstrap.is_ready(ctx) then
        on_done(true, "cached")
        return
    end
    if state.bootstrap_inflight then
        on_done(false, "inflight")
        return
    end

    local url = hud_bootstrap.build_url(ctx)
    if url == "" then
        on_done(false, "missing_api_base")
        return
    end

    state.bootstrap_inflight = true

    web.get(url, function(err, response)
        state.bootstrap_inflight = false
        err, response = util.normalize_web_response(err, response)
        if util.is_web_error(err) or not util.http_response_ok(response) then
            on_done(false, "http_error")
            return
        end
        local body = util.response_body(response)
        local data = util.decode_json(body)
        if apply_bootstrap_json(data, ctx) then
            on_done(true, "ok")
        else
            on_done(false, util.safe_str(data and data.reason) ~= "" and data.reason or "bootstrap_invalid")
        end
    end)
end

return hud_bootstrap
