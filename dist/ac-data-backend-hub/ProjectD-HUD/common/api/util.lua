--[[ HTTP/JSON/string helpers for ProjectD HUD API client. ]]

local state = require("common.api.state")

local util = {}

function util.safe_str(value)
    if value == nil then return "" end
    if type(value) == "string" then return value end
    if type(value) == "number" or type(value) == "boolean" then return tostring(value) end
    local ok, text = pcall(tostring, value)
    if ok and text ~= nil then return text end
    return ""
end

function util.safe_call(fn)
    local ok, value = pcall(fn)
    if not ok then return nil end
    return value
end

function util.is_web_error(err)
    if err == nil or err == false then return false end
    if type(err) == "string" and err == "" then return false end
    return true
end

--- CSP allows only 2 concurrent web.get; normalize callback args defensively.
function util.normalize_web_response(err, response)
    if type(err) == "table" and response == nil then
        return nil, err
    end
    if type(response) == "string" and err == nil then
        return nil, { status = 200, body = response }
    end
    if type(err) == "string" and not util.is_web_error(err) and response == nil then
        return nil, { status = 200, body = err }
    end
    return err, response
end

function util.http_status_code(response)
    if response == nil or type(response) ~= "table" then return nil end
    return tonumber(response.status)
end

function util.http_response_ok(response)
    if response == nil then return false end
    if type(response) == "string" then return true end
    local code = util.http_status_code(response)
    if code == nil then return true end
    return code == 200
end

function util.response_body(response)
    if response == nil then return nil end
    if type(response) == "string" then return response end
    if type(response) == "table" then
        return response.body or response.text or response.content or response.data
    end
    return nil
end

function util.parse_json_body(body)
    if type(body) == "table" then return body end
    if body == nil then return nil end
    body = util.safe_str(body)
    if body == "" then return nil end

    if JSON ~= nil and JSON.parse ~= nil then
        local ok, data = pcall(JSON.parse, body)
        if ok and type(data) == "table" then return data end
    end

    if __util ~= nil and __util.jsonParse ~= nil then
        local ok, data = pcall(__util.jsonParse, body)
        if ok and type(data) == "table" then return data end
    end

    local ok, mod = pcall(require, "lib_jsonparse")
    if ok and mod ~= nil then
        local ok2, data = pcall(mod, body)
        if ok2 and type(data) == "table" then return data end
    end

    return nil
end

function util.decode_json(body)
    local data = util.parse_json_body(body)
    if data == nil and body ~= nil and util.safe_str(body) ~= "" then
        state.last_error = "json_parse_failed"
    end
    return data
end

--- Presence / session errors from ac-data — do not retry.
function util.is_presence_fatal(reason)
    return reason == "not_managed_server"
        or reason == "players_on_different_servers"
end

function util.presence_message(reason)
    if reason == "not_managed_server" then return "Server not managed by ProjectD" end
    if reason == "players_on_different_servers" then return "Players on different servers" end
    return nil
end

--- Legacy ac-data reasons that must not block or display the HUD.
function util.should_ignore_error(reason)
    return reason == "player_not_connected"
end

--- Presence errors from ac-data are always surfaced (no client-side suppression).
function util.ignore_presence_error(_reason)
    return false
end

function util.should_show_presence_error(reason)
    if not util.is_presence_fatal(reason) then return false end
    return not util.ignore_presence_error(reason)
end

function util.apply_presence_error(reason)
    reason = tostring(reason or "")
    if util.should_ignore_error(reason) then return false end
    if util.ignore_presence_error(reason) then
        ac.debug("ProjectD-HUD presence", "ignored: " .. reason)
        return true
    end
    state.last_error = reason
    return true
end

function util.clear_stale_presence_error()
    if util.is_presence_fatal(state.last_error) and util.ignore_presence_error(state.last_error) then
        state.last_error = nil
    end
    if util.is_presence_fatal(state.battle_last_error) and util.ignore_presence_error(state.battle_last_error) then
        state.battle_last_error = nil
    end
end

function util.note_presence_ok()
    if util.is_presence_fatal(state.last_error) then
        state.last_error = nil
    end
end

--- Battle SSE connect errors that must not reconnect.
function util.is_battle_fatal(reason)
    if util.is_presence_fatal(reason) and util.ignore_presence_error(reason) then
        return false
    end
    if util.is_presence_fatal(reason) then return true end
    return reason == "Battle HUD SSE disabled"
        or reason == "Unauthorized"
        or reason == "steamId is required"
end

function util.battle_error_message(reason)
    local presence = util.presence_message(reason)
    if presence ~= nil then return presence end
    if reason == "Battle HUD SSE disabled" then return "Battle HUD unavailable" end
    if reason == "Unauthorized" then return "Battle authorization failed" end
    if reason == "steamId is required" then return "Steam ID required" end
    return nil
end

local function api_error_reason(raw)
    if raw == nil or type(raw) ~= "table" then return nil end
    if raw.ok == false and raw.reason ~= nil then
        return tostring(raw.reason)
    end
    if raw.error ~= nil then
        return tostring(raw.error)
    end
    if raw.reason ~= nil then
        return tostring(raw.reason)
    end
    return nil
end

--- Parse ac-data response even when HTTP status is 404 (body is often { ok:false, reason }).
function util.read_api_response(err, response)
    if util.is_web_error(err) then
        return nil, "network_error"
    end

    local code = util.http_status_code(response)
    local raw = util.parse_json_body(util.response_body(response))
    if raw == nil and type(response) == "table" then
        if response.ok ~= nil or response.reason ~= nil or response.error ~= nil
            or response.players ~= nil or response.profile ~= nil then
            raw = response
        end
    end

    local err_reason = api_error_reason(raw)
    if err_reason ~= nil and raw ~= nil and raw.ok == false then
        return raw, err_reason
    end

    if code == 403 and err_reason ~= nil then
        return raw, err_reason
    end

    if code ~= nil and code ~= 200 then
        if err_reason ~= nil then
            return raw, err_reason
        end
        return raw, "http_" .. tostring(code)
    end

    if raw == nil and util.http_response_ok(response) then
        return nil, "json_parse_failed"
    end

    return raw, nil
end

function util.url_encode(str)
    str = util.safe_str(str)
    if str == "" then return "" end
    return string.gsub(str, "([^%w%-%.%_%~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end)
end

function util.trim_server_name(name)
    name = util.safe_str(name)
    if name == "" then return "" end
    name = name:gsub("[%s%p]*[ℹiI]%d+%s*$", "")
    name = name:gsub("^%s+", ""):gsub("%s+$", "")
    return name
end

--- Short label: first segment of "ProjectD | Track | Mode | ...".
function util.normalize_server_name(name)
    name = util.trim_server_name(name)
    if name == "" then return "" end
    local pipe = name:find("|", 1, true)
    if pipe ~= nil then
        name = name:sub(1, pipe - 1)
    end
    return util.trim_server_name(name)
end

function util.count_table_entries(list)
    if list == nil or type(list) ~= "table" then return 0 end
    local count = 0
    for _, entry in ipairs(list) do
        if type(entry) == "table" then count = count + 1 end
    end
    if count > 0 then return count end
    for _, entry in pairs(list) do
        if type(entry) == "table" then count = count + 1 end
    end
    return count
end

function util.count_ui_rows(rows)
    if rows == nil or type(rows) ~= "table" then return 0 end
    local count = 0
    for i = 0, 128 do
        if rows[i] == nil then break end
        count = count + 1
    end
    return count
end

function util.split_track_and_layout(track_id, layout_id)
    track_id = util.safe_str(track_id)
    layout_id = util.safe_str(layout_id)
    if layout_id ~= "" then return track_id, layout_id end
    local base, rest = track_id:match("^([^%-]+)%-(.+)$")
    if base ~= nil and rest ~= nil and rest ~= "" then
        return base, rest
    end
    return track_id, layout_id
end

return util
