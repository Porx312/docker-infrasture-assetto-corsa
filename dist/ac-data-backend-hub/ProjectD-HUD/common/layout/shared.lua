--[[ Layout — shared constants and panel fit ]]

local M = {}

M.CARD_EDGE_PAD = 4
M.AVATAR_Y_EXTRA = 2

M.SIZE = {
    competition = vec2(360, 300),
    profile = vec2(280, 84),
    battle  = vec2(800, 172),
}

M.PANEL_NATIVE = vec2(1795, 533.17)
M.PANEL_ASPECT = M.PANEL_NATIVE.x / M.PANEL_NATIVE.y

function M.panel_scale(panel_size)
    return panel_size.x / M.PANEL_NATIVE.x
end

function M.panel_fit(win_size)
    local aspect = M.PANEL_ASPECT
    local draw_w, draw_h

    if win_size.x / win_size.y > aspect then
        draw_h = win_size.y
        draw_w = draw_h * aspect
    else
        draw_w = win_size.x
        draw_h = draw_w / aspect
    end

    local ox = (win_size.x - draw_w) * 0.5
    local oy = (win_size.y - draw_h) * 0.5
    return vec2(ox, oy), vec2(draw_w, draw_h)
end

function M.corners_all()
    return 15
end

return M
