--[[ Layout — assembles public layout API from domain modules ]]

local layout = {}

local modules = {
    "common.layout.shared",
    "common.layout.profile",
    "common.layout.competition",
    "common.layout.battle",
}

for _, path in ipairs(modules) do
    local mod = require(path)
    for k, v in pairs(mod) do
        layout[k] = v
    end
end

return layout
