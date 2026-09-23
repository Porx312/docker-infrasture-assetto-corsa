--[[ Steam ID64 + race.ini readers (CSP online apps cannot use ac.getUserSteamID). ]]

local state = require("common.api.state")
local util = require("common.api.util")

local steam = {}

local STEAM_BRIDGE_KEY = "ProjectD:playerSteamId"
local race_ini_cache = { at = 0, ini = nil }

--- SteamID64 exceeds IEEE double precision; never tonumber() a 17-digit string.
function steam.normalize_steam_id(value)
    if value == nil then return "" end

    local id = util.safe_str(value)
    if id ~= "" and id ~= "0" then
        id = id:gsub("%s+", "")
        id = id:gsub("^https?://steamcommunity%.com/profiles/", "")
        local digits_only = id:match("^(%d+)")
        if digits_only ~= nil and #digits_only >= 15 then return digits_only end
        local embedded = id:match("(%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d+)")
        if embedded ~= nil then return embedded end
    end

    if type(value) == "number" and value > 0 then
        return string.format("%.0f", value)
    end

    return ""
end

function steam.steam_ids_equal(a, b)
    local na = steam.normalize_steam_id(a)
    local nb = steam.normalize_steam_id(b)
    return na ~= "" and nb ~= "" and na == nb
end

local race_ini_resolved_path = ""

local function race_ini_paths()
    local paths, seen = {}, {}
    local function add(path)
        path = util.safe_str(path)
        if path == "" then return end
        local key = string.lower(path)
        if seen[key] then return end
        seen[key] = true
        paths[#paths + 1] = path
    end

    local ac_root = util.safe_call(function() return ac.getFolder(ac.FolderID.ACRoot) end)
    if util.safe_str(ac_root) ~= "" then
        add(ac_root .. "/cfg/race.ini")
    end

    local ac_docs = util.safe_call(function() return ac.getFolder(ac.FolderID.ACDocuments) end)
    if util.safe_str(ac_docs) ~= "" then
        add(ac_docs .. "/cfg/race.ini")
        add(ac_docs .. "/Assetto Corsa/cfg/race.ini")
    end

    local docs = util.safe_call(function() return ac.getFolder(ac.FolderID.Documents) end)
    if util.safe_str(docs) ~= "" then
        add(docs .. "/Assetto Corsa/cfg/race.ini")
        local onedrive = docs:match("(.*OneDrive[^/\\]*)")
        if onedrive ~= nil then
            add(onedrive .. "/Documents/Assetto Corsa/cfg/race.ini")
        end
    end

    if race_ini_resolved_path ~= "" then
        add(race_ini_resolved_path)
    end

    return paths
end

local function read_file(path)
    local ok, content = pcall(function()
        local file = io.open(path, "r")
        if file == nil then return nil end
        local data = file:read("*a")
        file:close()
        return data
    end)
    if ok and type(content) == "string" and content ~= "" then
        return content
    end
    return ""
end

local function get_race_ini()
    local now = os.clock()
    if race_ini_cache.ini ~= nil and (now - race_ini_cache.at) < 2 then
        return race_ini_cache.ini
    end
    race_ini_cache.ini = nil
    race_ini_cache.at = now

    if ac.INIConfig == nil or ac.INIConfig.load == nil or ac.INIFormat == nil then return nil end

    for _, path in ipairs(race_ini_paths()) do
        local ok, ini = pcall(ac.INIConfig.load, path, ac.INIFormat.Extended)
        if ok and ini ~= nil then
            race_ini_resolved_path = path
            race_ini_cache.ini = ini
            return ini
        end
    end
    return nil
end

local function race_remote_active(ini)
    if ini == nil then return false end
    return tonumber(ini:get("REMOTE", "ACTIVE", 0)) == 1
end

local function read_race_ini_raw()
    for _, path in ipairs(race_ini_paths()) do
        local content = read_file(path)
        if content ~= "" then
            race_ini_resolved_path = path
            return content
        end
    end
    return ""
end

local function steam_from_race_ini_raw(content, require_remote)
    if content == "" then return "" end

    local in_remote = false
    for line in content:gmatch("[^\r\n]+") do
        local section = line:match("^%[([^%]]+)%]")
        if section ~= nil then
            in_remote = section == "REMOTE"
        elseif in_remote or not require_remote then
            local guid = line:match("^GUID%s*=%s*(%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d+)")
            if guid ~= nil then return guid end
        end
    end

    if not require_remote then
        local any_guid = content:match("GUID%s*=%s*(%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d+)")
        if any_guid ~= nil then return any_guid end
    end

    return ""
end

function steam.steam_from_race_ini()
    local content = read_race_ini_raw()
    if content ~= "" then
        local id = steam_from_race_ini_raw(content, true)
        if id ~= "" then return id end
        id = steam_from_race_ini_raw(content, false)
        if id ~= "" then return id end
    end

    local ini = get_race_ini()
    if ini ~= nil then
        if race_remote_active(ini) then
            local id = steam.normalize_steam_id(ini:get("REMOTE", "GUID", ""))
            if id ~= "" then return id end
        end
        for _, section in ipairs({ "REMOTE", "RACE" }) do
            local id = steam.normalize_steam_id(ini:get(section, "GUID", ""))
            if id ~= "" then return id end
        end
    end

    return ""
end

local function server_fields_from_remote_content(content)
    if content == "" then return "", "" end
    local server_name, player_name = "", ""
    local in_remote = false
    for line in content:gmatch("[^\r\n]+") do
        local section = line:match("^%[([^%]]+)%]")
        if section ~= nil then
            in_remote = section == "REMOTE"
        elseif in_remote then
            local sn = line:match("^SERVER_NAME%s*=%s*(.+)$")
            if sn ~= nil and server_name == "" then
                server_name = util.trim_server_name(sn)
            end
            local nm = line:match("^NAME%s*=%s*(.+)$")
            if nm ~= nil and player_name == "" then
                player_name = util.trim_server_name(nm)
            end
        end
    end
    return server_name, player_name
end

--- AC [REMOTE] SERVER_NAME — full display title shown in the server browser.
function steam.server_display_name_raw()
    local content = read_race_ini_raw()
    local from_raw = select(1, server_fields_from_remote_content(content))
    if from_raw ~= "" then return from_raw end

    local ini = get_race_ini()
    if ini ~= nil then
        local name = util.trim_server_name(ini:get("REMOTE", "SERVER_NAME", ""))
        if name ~= "" then return name end
    end
    return ""
end

--- Short label (first segment before "|"), e.g. "ProjectD".
function steam.server_name_from_race_ini()
    local raw = steam.server_display_name_raw()
    if raw ~= "" then return util.normalize_server_name(raw) end
    return ""
end

--- [REMOTE] NAME is the player nick in AC, not the server id.
function steam.remote_player_name_from_race_ini()
    local content = read_race_ini_raw()
    local _, player_name = server_fields_from_remote_content(content)
    if player_name ~= "" then return player_name end

    local ini = get_race_ini()
    if ini ~= nil then
        return util.trim_server_name(ini:get("REMOTE", "NAME", ""))
    end
    return ""
end

--- Back-compat alias (debug only — do not use for API serverName).
function steam.server_slug_from_race_ini()
    return steam.remote_player_name_from_race_ini()
end

function steam.all_server_names_from_race_ini()
    local names, seen = {}, {}
    local function add_raw(name)
        name = util.trim_server_name(name)
        if name == "" then return end
        local key = string.lower(name)
        if seen[key] then return end
        seen[key] = true
        names[#names + 1] = name
    end
    local function add_short(name)
        name = util.normalize_server_name(name)
        if name == "" then return end
        local key = string.lower(name)
        if seen[key] then return end
        seen[key] = true
        names[#names + 1] = name
    end

    local raw = steam.server_display_name_raw()
    add_raw(raw)
    add_short(raw)

    local ini = get_race_ini()
    if ini ~= nil then
        local ini_raw = util.trim_server_name(ini:get("REMOTE", "SERVER_NAME", ""))
        add_raw(ini_raw)
        add_short(ini_raw)
    end
    return names
end

function steam.steam_from_online_bridge()
    local value = util.safe_call(function() return ac.load(STEAM_BRIDGE_KEY) end)
    return steam.normalize_steam_id(value)
end

--- Debug: whether race.ini was found and if [REMOTE] is active.
function steam.get_race_ini_status()
    local content = read_race_ini_raw()
    local ini = get_race_ini()
    local remote = race_remote_active(ini)
    local guid = ""
    if content ~= "" then
        guid = steam_from_race_ini_raw(content, false)
    end
    if guid == "" and ini ~= nil then
        guid = steam.normalize_steam_id(ini:get("REMOTE", "GUID", ""))
    end
    return {
        path = race_ini_resolved_path,
        found = content ~= "" or ini ~= nil,
        remote_active = remote,
        has_guid = guid ~= "",
        guid = guid,
    }
end

local function remember_steam_id(id)
    id = steam.normalize_steam_id(id)
    if id ~= "" then
        state.steam_cache_storage:set(id)
    end
    return id
end

function steam.read_player_steam_id(_sim)
    local override = steam.normalize_steam_id(state.steam_override_storage:get())
    if override ~= "" then return remember_steam_id(override) end

    local sources = {
        steam.steam_from_race_ini,
        steam.steam_from_online_bridge,
        function()
            if ac.getUserSteamID == nil then return "" end
            return steam.normalize_steam_id(util.safe_call(ac.getUserSteamID))
        end,
        function()
            return steam.normalize_steam_id(state.steam_cache_storage:get())
        end,
    }

    for _, read in ipairs(sources) do
        local id = util.safe_call(read) or ""
        if id ~= "" then return remember_steam_id(id) end
    end

    return ""
end

return steam
