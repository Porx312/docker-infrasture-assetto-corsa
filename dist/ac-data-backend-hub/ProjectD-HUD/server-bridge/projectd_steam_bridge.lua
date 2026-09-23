--[[
  ProjectD — CSP online script (server extra options / extension/lua/online/).
  Publishes local Steam ID64 for the HUD Lua app via ac.store (apps cannot call getUserSteamID).

  Install on ProjectD servers:
    Copy to assettocorsa/extension/lua/online/projectd_steam_bridge.lua
    Or paste in server CSP "Online scripts" extra options.
]]

local BRIDGE_KEY = "ProjectD:playerSteamId"

function script.update()
    if ac.getUserSteamID == nil then return end
    local steam = ac.getUserSteamID()
    if steam == nil or steam == "" then return end
    ac.store(BRIDGE_KEY, tostring(steam))
end
