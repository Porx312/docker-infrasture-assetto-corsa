--[[ Draw — competition lap time block ]]

local theme = require("common.theme")
local layout = require("common.layout")
local shared = require("common.draw.shared")
local helpers = require("common.draw.competition.helpers")

local M = {}

function M.draw_time_block(origin, entry, opts)
    theme.ensure_fonts()
    opts = opts or {}
    local col_w = opts.time_col_w or 88
    local row_h = opts.row_height or layout.ROW_H
    local is_self = entry.is_self == true
    local text_alpha = opts.alpha or 1
    local label_fs = opts.best_lap_label_fs or 8
    local time_fs = opts.time_fs or 12
    local delta_fs = opts.delta_fs or 9
    local trailing_pad = opts.trailing_pad or 4

    local block_right = origin.x + col_w - trailing_pad
    local cy = origin.y + row_h * 0.5
    local lap_ms = helpers.lap_ms(entry)
    local time_str = theme.format_lap(lap_ms)
    local time_col = is_self and theme.colors.accent or theme.colors.white
    time_col = helpers.text_color(time_col, text_alpha)
    local label_col = helpers.text_color(theme.colors.competition_best_lap, text_alpha)

    local delta_value, delta_col
    if not is_self then
        delta_value, delta_col = helpers.delta_parts(lap_ms, opts.player_lap_ms)
    end
    local has_delta = delta_value ~= nil

    local label_gap = 3
    local delta_gap = 2

    ui.pushDWriteFont(theme.fonts.bold)
    local time_w = shared.measure_text(theme.fonts.bold, time_str, time_fs)
    local time_y = cy - time_fs * 0.5
    local time_x = block_right - time_w
    ui.dwriteDrawText(time_str, time_fs, vec2(time_x, time_y), time_col)
    ui.popDWriteFont()

    ui.pushDWriteFont(theme.fonts.reg)
    local label = "BEST LAP"
    local label_w = shared.measure_text(theme.fonts.reg, label, label_fs)
    ui.dwriteDrawText(
        label, label_fs,
        vec2(block_right - label_w, time_y - label_fs - label_gap),
        label_col
    )
    ui.popDWriteFont()

    if has_delta then
        local delta_y = time_y + time_fs + delta_gap
        ui.pushDWriteFont(theme.fonts.reg)
        local value_w = shared.measure_text(theme.fonts.reg, delta_value, delta_fs)
        ui.dwriteDrawText(
            delta_value, delta_fs,
            vec2(block_right - value_w, delta_y),
            helpers.text_color(delta_col, text_alpha)
        )
        ui.popDWriteFont()
    end
end

return M
