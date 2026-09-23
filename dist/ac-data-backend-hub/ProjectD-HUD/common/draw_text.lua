--[[ Shared DWrite text measurement and drawing helpers. ]]

local theme = require("common.theme")

local draw_text = {}

function draw_text.measure(font, text, fs)
    ui.pushDWriteFont(font)
    local w = ui.measureDWriteText(text, fs).x
    ui.popDWriteFont()
    return w
end

function draw_text.measure_size(font, text, fs)
    ui.pushDWriteFont(font)
    local sz = ui.measureDWriteText(text, fs)
    ui.popDWriteFont()
    return sz
end

function draw_text.centered(text, fs, point, color, font)
    if text == nil or text == "" then return end
    font = font or theme.fonts.bold
    ui.pushDWriteFont(font)
    local w = draw_text.measure(font, text, fs)
    ui.dwriteDrawText(text, fs, vec2(point.x - w * 0.5, point.y - fs * 0.52), color)
    ui.popDWriteFont()
end

function draw_text.anchored(text, fs, point, anchor, color, font)
    if text == nil or text == "" then return end
    font = font or theme.fonts.bold
    ui.pushDWriteFont(font)
    local w = draw_text.measure(font, text, fs)
    local x = point.x
    if anchor == "center" then
        x = point.x - w * 0.5
    elseif anchor == "right" then
        x = point.x - w
    end
    ui.dwriteDrawText(text, fs, vec2(x, point.y), color)
    ui.popDWriteFont()
end

function draw_text.live_event_differs_from_center(event_label, center_text)
    event_label = tostring(event_label or "")
    if event_label == "" then return false end
    local upper_center = string.upper(tostring(center_text or ""))
    local upper_event = string.upper(event_label)
    if upper_event == upper_center then return false end
    if upper_center == "ACTIVE" and upper_event == "ACTIVE" then return false end
    return true
end

return draw_text
