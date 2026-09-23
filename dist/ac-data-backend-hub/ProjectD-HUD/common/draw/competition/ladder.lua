--[[ Draw — competition ladder list + FLIP animation ]]

local layout = require("common.layout")
local helpers = require("common.draw.competition.helpers")
local row_mod = require("common.draw.competition.row")

local M = {}

local function draw_row_at_y(panel_o, content, row_x, list_top, entry, y_rel, border_style, row_ctx)
    if entry == nil then return end
    local y = panel_o.y + list_top + y_rel
    local is_self = entry.is_self == true
    local row_opts = layout.competition_row_opts(content, is_self)
    row_ctx = row_ctx or {}
    row_opts.row_id = "comp_" .. tostring(entry.name or entry.rank)
    row_opts.alpha = 1
    row_opts.dimmed = false
    row_opts.draw_separator = false
    row_opts.border_style = border_style or "gray"
    row_opts.player_lap_ms = row_ctx.player_lap_ms
    row_opts.player_rank = row_ctx.player_rank
    row_opts.slot_index = helpers.status_slot(
        entry, row_ctx.slot_index, row_ctx.player_rank, content, y_rel
    )
    row_mod.draw_row(vec2(row_x, y), entry, row_opts)
end

function M.competition_panel(win_origin, win_size)
    local po, ps = layout.competition_fit(win_size)
    return po, ps
end

function M.competition_ladder(panel_o, panel_size, content, ladder, anim_state)
    local ins = content.clip_inset or { top = 4, bottom = 4, left = 4, right = 4 }
    local list_top = content.list_top
    local row_x = panel_o.x + ins.left + content.pad + (content.card_inset_x or 0)
    local clip_tl = vec2(panel_o.x + ins.left, panel_o.y + ins.top)
    local clip_br = vec2(panel_o.x + panel_size.x - ins.right, panel_o.y + panel_size.y - ins.bottom)

    ui.pushClipRect(clip_tl, clip_br)

    local player_lap_ms = helpers.player_lap(ladder)
    local player_rank = helpers.player_rank(ladder)

    if anim_state ~= nil and anim_state.mode == "flip_reorder" and anim_state.items ~= nil then
        local sorted = {}
        for _, item in ipairs(anim_state.items) do
            sorted[#sorted + 1] = item
        end
        table.sort(sorted, function(a, b) return a.y < b.y end)
        for _, item in ipairs(sorted) do
            if item.entry ~= nil then
                draw_row_at_y(
                    panel_o, content, row_x, list_top, item.entry, item.y,
                    helpers.flip_item_border(item, anim_state),
                    { player_lap_ms = player_lap_ms, player_rank = player_rank, slot_index = item.slot }
                )
            end
        end
    elseif ladder ~= nil and ladder.slots ~= nil then
        for i = 0, layout.COMPETITION_ROW_COUNT - 1 do
            local entry = ladder.slots[i]
            if entry ~= nil then
                local y = layout.competition_slot_y(content, i)
                draw_row_at_y(
                    panel_o, content, row_x, list_top, entry, y, "gray",
                    { player_lap_ms = player_lap_ms, player_rank = player_rank, slot_index = i }
                )
            end
        end
    end

    ui.popClipRect()
end

function M.competition_row(origin, entry, opts)
    row_mod.draw_row(origin, entry, opts)
end

function M.competition_time_block(origin, entry, opts)
    local time_block = require("common.draw.competition.time_block")
    time_block.draw_time_block(origin, entry, opts)
end

return M
