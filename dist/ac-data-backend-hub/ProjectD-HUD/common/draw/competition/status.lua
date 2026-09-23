--[[ Draw — competition status column (YOU / NEXT RANK / SAFE POS) ]]

local theme = require("common.theme")
local layout = require("common.layout")
local shared = require("common.draw.shared")
local helpers = require("common.draw.competition.helpers")

local M = {}

local function draw_status_stacked(origin, status_w, lines, color, fs, alpha, start_y)
    if lines == nil or #lines == 0 then return end
    fs = fs or 6
    local line_h = fs + 2
    local y = start_y
    ui.pushDWriteFont(theme.fonts.bold)
    for _, line in ipairs(lines) do
        local tw = shared.measure_text(theme.fonts.bold, line, fs)
        ui.dwriteDrawText(
            line, fs,
            vec2(origin.x + (status_w - tw) * 0.5, y),
            helpers.text_color(color, alpha)
        )
        y = y + line_h
    end
    ui.popDWriteFont()
end

function M.draw_status(origin, row_h, slot_index, is_self, opts)
    local text_alpha = opts.alpha or 1
    local status_w = opts.status_col_w or 26
    local status_fs = opts.status_fs or 5
    local you_fs = opts.you_fs or 6
    local inner_pad = opts.card_inner_pad or 4
    local cy = origin.y + row_h * 0.5
    local sx = origin.x + inner_pad

    if is_self then
        local label = "YOU"
        ui.pushDWriteFont(theme.fonts.bold)
        local tw = shared.measure_text(theme.fonts.bold, label, you_fs)
        local th = you_fs
        local pad_x = 5
        local pad_y = 3
        local pill_w = tw + pad_x * 2
        local pill_h = th + pad_y * 2
        local pill_x = sx + math.max(0, (status_w - pill_w) * 0.5)
        local pill_y = cy - pill_h * 0.5
        ui.drawRectFilled(
            vec2(pill_x, pill_y),
            vec2(pill_x + pill_w, pill_y + pill_h),
            helpers.text_color(theme.colors.competition_you_bg, text_alpha),
            3, layout.corners_all()
        )
        ui.dwriteDrawText(
            label, you_fs,
            vec2(pill_x + pad_x, pill_y + (pill_h - th) * 0.5 - 1),
            helpers.text_color(theme.colors.competition_you_text, text_alpha)
        )
        ui.popDWriteFont()
        return
    end

    local label_col
    local lines
    local arrow
    if slot_index == 0 then
        label_col = theme.colors.competition_status_above
        arrow = "▲"
        lines = { "NEXT", "RANK" }
    elseif slot_index == 2 then
        label_col = theme.colors.competition_status_below
        arrow = "▼"
        lines = { "SAFE", "POS" }
    else
        return
    end

    local arrow_fs = opts.arrow_fs or math.max(14, math.floor(row_h * 0.26))
    local arrow_text_gap = math.max(5, math.floor(status_fs * 0.65))
    local line_sp = status_fs + 1
    local block_h = arrow_fs + arrow_text_gap + (#lines * line_sp)
    local block_top = cy - block_h * 0.5

    ui.pushDWriteFont(theme.fonts.bold)
    local aw = shared.measure_text(theme.fonts.bold, arrow, arrow_fs)
    ui.dwriteDrawText(
        arrow, arrow_fs,
        vec2(sx + (status_w - aw) * 0.5, block_top),
        helpers.text_color(label_col, text_alpha)
    )
    ui.popDWriteFont()

    draw_status_stacked(
        vec2(sx, block_top + arrow_fs + arrow_text_gap),
        status_w, lines, label_col, status_fs, text_alpha,
        block_top + arrow_fs + arrow_text_gap
    )
end

return M
