--[[ Layout — competition ladder (3 rows) ]]

local M = {}

M.PAD_COMPETITION = 4
M.COMPETITION_PAD = 4
M.COMPETITION_ROW_COUNT = 3
M.COMPETITION_CENTER_SCALE = 1.0
M.COMPETITION_SIDE_SCALE = 1.0
M.COMPETITION_CARD_WIDTH_RATIO = 0.92
M.COMPETITION_BLOCK_RATIO = 0.98
M.COMPETITION_CLIP_INSET = { top = 4, bottom = 4, left = 10, right = 10 }
M.COMPETITION_YOU_TAB_OVERHANG = 0
M.COMPETITION_FLIP_SEC = 0.9
M.COMPETITION_FLIP_SEC_RIVAL = 0.55
M.ROW_H = 40

function M.competition_fit(win_size)
    return vec2(0, 0), win_size
end

function M.competition_content(panel_size)
    local pad = M.COMPETITION_PAD
    local rows = M.COMPETITION_ROW_COUNT
    local clip = M.COMPETITION_CLIP_INSET or { top = 12, bottom = 12, left = 8, right = 8 }
    local clip_h = math.max(1, panel_size.y - clip.top - clip.bottom)
    local block_max_h = clip_h * (M.COMPETITION_BLOCK_RATIO or 0.97)
    local row_gap = math.max(9, math.floor(clip_h * 0.030))

    local uniform_row_h = (block_max_h - row_gap * (rows - 1)) / rows
    local side_row_h = uniform_row_h
    local center_row_h = uniform_row_h
    local block_h = uniform_row_h * rows + row_gap * (rows - 1)
    local list_top = clip.top + math.max(0, (clip_h - block_h) * 0.5)
    local full_content_w = panel_size.x - pad * 2 - clip.left - clip.right
    local card_width_ratio = M.COMPETITION_CARD_WIDTH_RATIO or 1.0
    local content_width = math.floor(full_content_w * card_width_ratio)
    local card_inset_x = math.floor((full_content_w - content_width) * 0.5)

    local function row_metrics(row_h)
        local rh = row_h / 32
        local card_inner_pad = 5
        local status_gap = 2
        local name_fs = math.min(17, math.max(13, math.floor(13.5 * rh)))
        local time_fs = math.min(26, math.max(18, math.floor(row_h * 0.44)))
        local avatar_size = math.max(22, math.floor(row_h * 0.78))
        local tier_size = math.max(14, math.floor(avatar_size * 0.44))
        local status_col_w = math.max(30, math.min(38, math.floor(32 * rh)))
        local avatar_identity_gap = math.max(1, math.floor(1.5 * rh))
        local col_gap = math.max(14, math.floor(12 * rh))
        local time_col_w = math.max(92, math.floor(content_width * 0.28))
        local avatar_col_w = avatar_size

        local left_w = card_inner_pad + status_col_w + status_gap + avatar_col_w + avatar_identity_gap
        local right_w = card_inner_pad + time_col_w
        local identity_w = content_width - left_w - right_w - col_gap
        if identity_w < 56 then
            time_col_w = math.max(92, time_col_w - (56 - identity_w))
            right_w = card_inner_pad + time_col_w
            identity_w = content_width - left_w - right_w - col_gap
        end
        identity_w = math.max(56, identity_w)

        return {
            row_height = row_h,
            content_width = content_width,
            avatar_size = avatar_size,
            tier_size = tier_size,
            status_col_w = status_col_w,
            status_gap = status_gap,
            avatar_col_w = avatar_col_w,
            avatar_identity_gap = avatar_identity_gap,
            time_col_w = time_col_w,
            identity_w = identity_w,
            col_gap = col_gap,
            name_fs = name_fs,
            car_fs = math.max(9, math.floor(name_fs * 0.72)),
            rank_label_fs = math.max(10, math.floor(name_fs * 0.78)),
            best_lap_label_fs = math.max(11, math.floor(time_fs * 0.50)),
            status_fs = math.max(7, math.floor(name_fs * 0.52)),
            you_fs = math.max(10, math.floor(name_fs * 0.68)),
            arrow_fs = math.max(14, math.floor(row_h * 0.26)),
            time_fs = time_fs,
            delta_fs = math.max(12, math.floor(time_fs * 0.56)),
            delta_suffix_fs = math.max(9, math.floor(time_fs * 0.42)),
            card_radius = 8,
            card_inner_pad = card_inner_pad,
            text_gap = math.max(3, math.floor(3 * rh)),
            text_line_gap = math.max(3, math.floor(rh)),
            trailing_pad = 4,
        }
    end

    local side_row = row_metrics(side_row_h)

    return {
        pad = pad,
        list_top = list_top,
        block_h = block_h,
        row_h = side_row_h,
        side_row_h = side_row_h,
        center_row_h = center_row_h,
        row_heights = {
            [0] = side_row_h,
            [1] = center_row_h,
            [2] = side_row_h,
        },
        row_count = rows,
        content_width = content_width,
        card_inset_x = card_inset_x,
        row_gap = row_gap,
        row_step = side_row_h + row_gap,
        clip_inset = clip,
        you_tab_overhang = M.COMPETITION_YOU_TAB_OVERHANG or 6,
        row = side_row,
        side_row = side_row,
        center_row = side_row,
        name_fs = side_row.name_fs,
    }
end

function M.competition_slot_y(content, slot_index)
    local y = 0
    for i = 0, slot_index - 1 do
        y = y + (content.row_heights[i] or content.side_row_h) + (content.row_gap or 0)
    end
    return y
end

function M.competition_visual_slot(content, y_rel)
    local best_slot = 1
    local best_dist = math.huge
    for i = 0, M.COMPETITION_ROW_COUNT - 1 do
        local sy = M.competition_slot_y(content, i)
        local d = math.abs(y_rel - sy)
        if d < best_dist then
            best_dist = d
            best_slot = i
        end
    end
    return best_slot
end

function M.competition_row_opts(content, is_self)
    local src = content.row or content.side_row
    return {
        row_height = src.row_height,
        content_width = src.content_width,
        avatar_size = src.avatar_size,
        tier_size = src.tier_size,
        status_col_w = src.status_col_w,
        status_gap = src.status_gap,
        avatar_col_w = src.avatar_col_w,
        avatar_identity_gap = src.avatar_identity_gap,
        time_col_w = src.time_col_w,
        identity_w = src.identity_w,
        col_gap = src.col_gap,
        name_fs = src.name_fs,
        car_fs = src.car_fs,
        rank_label_fs = src.rank_label_fs,
        best_lap_label_fs = src.best_lap_label_fs,
        status_fs = src.status_fs,
        you_fs = src.you_fs,
        arrow_fs = src.arrow_fs,
        time_fs = src.time_fs,
        delta_fs = src.delta_fs,
        delta_suffix_fs = src.delta_suffix_fs,
        card_radius = src.card_radius,
        card_inner_pad = src.card_inner_pad,
        you_tab_overhang = content.you_tab_overhang or M.COMPETITION_YOU_TAB_OVERHANG or 0,
        text_gap = src.text_gap,
        text_line_gap = src.text_line_gap or 1,
        trailing_pad = src.trailing_pad,
        no_input = true,
    }
end

return M
