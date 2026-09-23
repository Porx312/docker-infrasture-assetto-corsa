--[[ Draw — competition row card background ]]

local theme = require("common.theme")
local images = require("common.images")
local layout = require("common.layout")
local helpers = require("common.draw.competition.helpers")

local M = {}

function M.draw_card(origin, row_size, alpha, card_radius)
    card_radius = card_radius or 8
    local br = origin + row_size
    local tex = images.get_competition_rivals_overlay()
    if tex ~= nil then
        ui.drawImageRounded(
            tex, origin, br,
            rgbm(1, 1, 1, alpha),
            vec2(0, 0), vec2(1, 1),
            card_radius, layout.corners_all()
        )
    else
        ui.drawRectFilled(
            origin, br,
            helpers.text_color(theme.colors.competition_card_fill, alpha),
            card_radius, layout.corners_all()
        )
    end
    ui.drawRectFilled(
        origin, br,
        rgbm(0, 0, 0, 0.45 * alpha),
        card_radius, layout.corners_all()
    )
end

return M
