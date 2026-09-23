--[[ Draw — competition helpers ]]

local theme = require("common.theme")
local layout = require("common.layout")

local M = {}

function M.lap_ms(entry)
    if entry == nil then return nil end
    local ms = entry.lap_ms or entry.best_lap_ms
    ms = tonumber(ms)
    if ms == nil or ms <= 0 then return nil end
    return ms
end

function M.delta_parts(rival_lap, player_lap)
    if rival_lap == nil or player_lap == nil then return nil, nil end
    local gap_ms = rival_lap - player_lap
    if math.abs(gap_ms) < 1 then return nil, nil end
    local gap_str = theme.format_lap_gap_sec(gap_ms)
    if gap_ms > 0 then
        return "-" .. gap_str, theme.colors.competition_delta_ahead
    end
    return "+" .. gap_str, theme.colors.competition_delta_behind
end

function M.text_color(base, alpha)
    return rgbm(base.r, base.g, base.b, base.mult * alpha)
end

function M.avatar_ring(slot_index, is_self, border_style)
    if is_self and border_style == "up" then
        return theme.colors.competition_rank_up
    end
    if is_self and border_style == "down" then
        return theme.colors.competition_rank_down
    end
    if is_self then
        return theme.colors.competition_avatar_ring_self
    end
    if slot_index == 0 then
        return theme.colors.competition_avatar_ring_above
    end
    return theme.colors.competition_avatar_ring_below
end

function M.player_rank(ladder)
    if ladder == nil then return nil end
    local rank = tonumber(ladder.player_rank)
    if rank ~= nil and rank > 0 then return rank end
    local center = ladder.slots and ladder.slots[1]
    if center ~= nil then
        return tonumber(center.rank)
    end
    return nil
end

function M.player_lap(ladder)
    if ladder == nil or ladder.slots == nil then return nil end
    local center = ladder.slots[1]
    return M.lap_ms(center)
end

function M.status_slot(entry, slot_index, player_rank, content, y_rel)
    if entry.is_self then return 1 end
    local rival_rank = tonumber(entry.rank)
    local pr = tonumber(player_rank)
    if rival_rank ~= nil and pr ~= nil and rival_rank ~= pr then
        return rival_rank < pr and 0 or 2
    end
    if content ~= nil and y_rel ~= nil then
        return layout.competition_visual_slot(content, y_rel)
    end
    local slot = tonumber(slot_index)
    if slot ~= nil then return slot end
    return 0
end

function M.flip_item_border(item, anim_state)
    if item.is_self ~= true or anim_state.player_direction == nil then
        return "gray"
    end
    return anim_state.player_direction
end

return M
