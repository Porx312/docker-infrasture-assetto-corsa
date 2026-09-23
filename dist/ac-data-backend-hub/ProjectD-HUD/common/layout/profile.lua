--[[ Layout — profile widget metrics ]]

local shared = require("common.layout.shared")

local M = {}

M.PROFILE_DESIGN = {
    avatar = 465.7,
    name_fs = 188,
    sub_fs = 104,
    tier = 228,
    avatar_gap = 32,
    name_tier_gap = 38,
    line_gap = 20,
}

function M.profile_metrics(panel_size)
    local s = shared.panel_scale(panel_size)
    local d = M.PROFILE_DESIGN
    return {
        avatar = d.avatar * s,
        name_fs = d.name_fs * s,
        sub_fs = d.sub_fs * s,
        tier = d.tier * s,
        avatar_gap = d.avatar_gap * s,
        name_tier_gap = d.name_tier_gap * s,
        line_gap = d.line_gap * s,
    }
end

return M
