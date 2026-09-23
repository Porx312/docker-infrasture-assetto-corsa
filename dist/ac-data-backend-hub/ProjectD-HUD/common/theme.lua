--[[ ProjectD HUD — colores y tipografía ]]

local theme = {}

theme.colors = {
    white         = rgbm(1, 1, 1, 1),
    muted         = rgbm(0.55, 0.55, 0.58, 1),
    accent        = rgbm(0.35, 0.78, 1.0, 1),
    bg            = rgbm(0, 0, 0, 0.55),
    bg_card       = rgbm(0, 0, 0, 0.65),
    panel_overlay = rgbm(1, 1, 1, 1),
    leaderboard_overlay = rgbm(1, 1, 1, 1),
    competition_rivals_overlay = rgbm(1, 1, 1, 1),
    panel_border  = rgbm(1, 1, 1, 0.06),
    leaderboard_sep = rgbm(1, 1, 1, 0.22),
    competition_row_border = rgbm(0.55, 0.55, 0.58, 0.38),
    competition_row_fill = rgbm(1, 1, 1, 0.04),
    competition_name = rgbm(1, 1, 1, 1),
    competition_name_self = rgbm(0.62, 0.94, 1.0, 1),
    competition_car = rgbm(0.78, 0.80, 0.84, 1),
    competition_rank_label = rgbm(0.68, 0.72, 0.78, 1),
    competition_best_lap = rgbm(0.58, 0.62, 0.68, 1),
    competition_you_bg = rgbm(0.35, 0.82, 1.0, 1),
    competition_you_text = rgbm(0.04, 0.08, 0.14, 1),
    competition_status_above = rgbm(1.0, 0.45, 0.45, 1),
    competition_status_below = rgbm(0.38, 0.92, 0.58, 1),
    competition_rank_up = rgbm(0.28, 0.95, 0.50, 1),
    competition_rank_up_fill = rgbm(0.22, 0.88, 0.42, 0.12),
    competition_rank_down = rgbm(1.0, 0.38, 0.38, 1),
    competition_rank_down_fill = rgbm(0.92, 0.28, 0.28, 0.12),
    competition_delta_ahead = rgbm(0.32, 0.95, 0.55, 1),
    competition_delta_behind = rgbm(1.0, 0.42, 0.42, 1),
    competition_avatar_ring_self = rgbm(0.45, 0.88, 1.0, 1),
    competition_avatar_ring_above = rgbm(1.0, 0.42, 0.42, 1),
    competition_avatar_ring_below = rgbm(0.35, 0.92, 0.55, 1),
    competition_card_fill = rgbm(0.06, 0.08, 0.12, 0.88),
    competition_card_border_above = rgbm(1.0, 0.38, 0.38, 0.85),
    competition_card_border_self = rgbm(0.40, 0.85, 1.0, 0.95),
    competition_card_border_below = rgbm(0.32, 0.90, 0.52, 0.85),
    competition_card_glow_self = rgbm(0.35, 0.78, 1.0, 0.22),
    competition_delta_suffix = rgbm(0.55, 0.58, 0.62, 1),
    avatar_ring   = rgbm(1, 1, 1, 0.35),
    avatar_fill   = rgbm(0.12, 0.12, 0.15, 1),
    tier_fallback = rgbm(0.85, 0.15, 0.12, 1),
    rival_tag     = rgbm(0.82, 0.12, 0.10, 1),
    battle_bg     = rgbm(0.03, 0.06, 0.14, 0.92),
    battle_border = rgbm(1, 1, 1, 0.88),
    battle_mode_bg = rgbm(0.06, 0.14, 0.32, 0.98),
    battle_vs       = rgbm(0.55, 0.88, 1.0, 1),
    battle_gap_fill = rgbm(0.62, 0.10, 0.14, 0.95),
    battle_gap_track = rgbm(1, 1, 1, 0.10),
    battle_gap_safe = rgbm(0.18, 0.72, 0.38, 0.95),
    battle_gap_center = rgbm(1, 1, 1, 0.85),
    battle_gap_green = rgbm(0.2, 0.85, 0.45, 0.9),
    battle_gap_red = rgbm(1.0, 0.18, 0.22, 0.98),
    battle_gap_opponent = rgbm(0.95, 0.95, 1.0, 0.95),
    battle_gap_closing = rgbm(0.35, 0.95, 0.55, 1),
    battle_gap_opening = rgbm(1.0, 0.40, 0.40, 1),
    tab_active    = rgbm(0.35, 0.78, 1.0, 0.38),
    tab_idle      = rgbm(1, 1, 1, 0.08),
}

theme.fonts = {}
local fonts_ready = false
local fonts_source = "unknown"

local app_dir = ac.dirname()
local FONT_FAMILY = "BBH Bogle"
local FONT_FILE = "BBHBogle-Regular.ttf"

local function system_font(name, weight)
    local font = ui.DWriteFont(name .. ":@System")
    if weight ~= nil then
        font = font:weight(weight)
    end
    return font
end

local function bundled_font_path()
    local flat = app_dir .. "/fonts/" .. FONT_FILE
    if io.fileExists(flat) then
        return flat
    end
    local nested = app_dir .. "/fonts/BBH_Bogle/" .. FONT_FILE
    if io.fileExists(nested) then
        return nested
    end
    return nil
end

local function has_bundled_fonts()
    return bundled_font_path() ~= nil
end

local function bundled_font(weight)
    return ui.DWriteFont(FONT_FAMILY .. ":/fonts;Weight=" .. weight)
end

--- BBH Bogle (único peso Regular embebido; bold/medium usan la misma familia).
function theme.ensure_fonts()
    if fonts_ready then return end
    fonts_ready = true

    if has_bundled_fonts() then
        fonts_source = "bundled"
        local base = bundled_font("Regular")
        theme.fonts.reg = base
        theme.fonts.small = base
        theme.fonts.medium = base
        theme.fonts.bold = base
        return
    end

    fonts_source = "system"
    theme.fonts.reg    = system_font("Segoe UI")
    theme.fonts.small  = system_font("Segoe UI")
    theme.fonts.medium = system_font("Segoe UI", ui.DWriteFont.Weight.Medium)
    theme.fonts.bold   = system_font("Segoe UI", ui.DWriteFont.Weight.Bold)
end

function theme.get_fonts_source()
    theme.ensure_fonts()
    return fonts_source
end

function theme.format_lap(ms)
    if ms == nil or ms <= 0 then return "--:--.---" end
    local total_sec = ms / 1000
    local min = math.floor(total_sec / 60)
    local sec = total_sec - min * 60
    if min > 0 then
        return string.format("%d:%06.3f", min, sec)
    end
    return string.format("0:%06.3f", sec)
end

--- Gap absoluto en segundos (3 decimales) para delta vs jugador.
function theme.format_lap_gap_sec(ms)
    if ms == nil then return "0.000" end
    return string.format("%.3f", math.abs(ms) / 1000)
end

--- Código corto de coche para profile/rival (#2 AE86 - 4:39.65).
function theme.format_car_short(car_name, car_id)
    if car_id ~= nil and car_id ~= "" then
        local id = string.lower(car_id)
        local by_id = {
            ae86_trueno = "AE86",
            ae86_levin = "AE86",
            ae85_levin = "AE85",
            rx7_fc = "FC",
            rx7_fd = "FD",
            s13_silvia = "S13",
            s15_silvia = "S15",
            civic_eg6 = "EG6",
            evo_iv = "EVO4",
            evo_v = "EVO5",
            gt86 = "86",
        }
        if by_id[id] ~= nil then return by_id[id] end
        local tail = id:match("([^_]+)$")
        if tail ~= nil then
            tail = tail:upper()
            if #tail <= 5 then return tail end
        end
    end

    if car_name == nil or car_name == "" then return "?" end

    local upper = string.upper(car_name)

    if upper:find("AE86", 1, true) then return "AE86" end
    if upper:find("AE85", 1, true) then return "AE85" end
    if upper:find("EG6", 1, true) then return "EG6" end
    if upper:find("S15", 1, true) then return "S15" end
    if upper:find("S13", 1, true) then return "S13" end
    if upper:find("86 GT", 1, true) or upper:find("GT86", 1, true) then return "86" end

    if upper:find("EVO", 1, true) then
        local gen = upper:match("EVO%s*([IVX%d]+)") or upper:match("(%d+)")
        if gen == "IV" or gen == "4" then return "EVO4" end
        if gen == "V" or gen == "5" then return "EVO5" end
        if gen ~= nil then return "EVO" .. gen end
        return "EVO"
    end

    if upper:find("SILEIGHTY", 1, true) or upper:find("SIL80", 1, true) then return "S13" end

    if upper:find("RX", 1, true) or upper:find("7", 1, true) then
        if upper:find("FD", 1, true) then return "FD" end
        if upper:find("FC", 1, true) then return "FC" end
    end
    if upper:find("FD", 1, true) then return "FD" end
    if upper:find("FC", 1, true) then return "FC" end

    local last = car_name:match("([%w%-]+)$")
    if last ~= nil then
        last = last:upper():gsub("-", "")
        if #last <= 6 then return last end
    end

    return car_name:sub(1, 6):upper()
end

--- Etiqueta de coche para HUD: al menos dos palabras cuando existan; si no, una.
function theme.format_car_label(car_name, car_id)
    local car = car_name
    if car == nil or car == "" then
        if car_id ~= nil and car_id ~= "" then
            car = string.gsub(car_id, "_", " ")
        else
            return "?"
        end
    end

    car = car:gsub("^%s+", ""):gsub("%s+$", ""):gsub("%s+", " ")
    if car == "" then return "?" end

    local words = {}
    for word in car:gmatch("%S+") do
        words[#words + 1] = word
        if #words >= 2 then break end
    end

    if #words == 0 then return "?" end
    if #words == 1 then return words[1] end
    return words[1] .. " " .. words[2]
end

--- Nombre corto para HUD (la API puede enviarlo ya recortado).
function theme.format_display_name(name, max_len)
    max_len = max_len or 11
    if name == nil or name == "" then return "?" end
    local first = name:match("^(%S+)") or name
    if #first > max_len then
        return first:sub(1, max_len)
    end
    return first
end

return theme
