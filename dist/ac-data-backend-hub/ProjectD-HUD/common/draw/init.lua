--[[ Draw — assembles public draw API from domain modules ]]

local draw = {}

local modules = {
    "common.draw.shared",
    "common.draw.competition.init",
    "common.draw.profile",
}

for _, path in ipairs(modules) do
    local mod = require(path)
    for k, v in pairs(mod) do
        draw[k] = v
    end
end

local draw_battle_mod

local function draw_battle()
    if draw_battle_mod == nil then
        draw_battle_mod = require("common.draw.battle.init")
    end
    return draw_battle_mod
end

function draw.battle_panel(bar_origin, bar_size)
    return draw_battle().battle_panel(bar_origin, bar_size)
end

function draw.battle_block(panel_o, panel_size, battle, opts)
    draw_battle().battle_block(panel_o, panel_size, battle, opts)
end

return draw
