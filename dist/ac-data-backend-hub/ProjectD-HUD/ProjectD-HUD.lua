-- keep the filename of this file the same as the folder that contains it



Dt = 0

Time = 0



local competition = require("competition.first")

local profile = require("profile.first")

local battle = require("battle.first")

local theme = require("common.theme")



local init = false



local function safe_main(mod, dt, label)

    local ok, err = pcall(mod.main, dt)

    if not ok then

        local msg = tostring(err)

        ac.debug("ProjectD-HUD " .. label .. " error", msg)

        theme.ensure_fonts()

        local win = ui.windowSize()

        ui.drawRectFilled(vec2(0, 0), win, rgbm(0, 0, 0, 0.85))

        local font = theme.fonts.reg

        if font ~= nil then ui.pushDWriteFont(font) end

        ui.dwriteDrawText(label .. " error:", 11, vec2(6, 6), rgbm(1, 0.5, 0.5, 1))

        ui.dwriteDrawText(msg, 10, vec2(6, 22), rgbm(1, 0.85, 0.85, 1))

        if font ~= nil then ui.popDWriteFont() end

    end

end



local function session_start()

    pcall(function()

        local data = require("common.data")

        if data.on_session_start ~= nil then data.on_session_start() end

    end)

    competition.on_session_start()

    profile.on_session_start()

    battle.on_session_start()

    pcall(function()
        require("common.display_style").preload_fonts()
    end)

end



function script.update(dt)

    Dt = dt

    Time = Time + Dt



    if init == false then

        init = true

        ac.onSessionStart(session_start)

        pcall(function()

            local data = require("common.data")

            if data.init ~= nil then data.init() end

        end)

        pcall(competition.init)

        pcall(profile.init)

        pcall(battle.init)

        pcall(function()
            require("common.display_style").preload_fonts()
        end)

    end



    pcall(function()

        local data = require("common.data")

        if data.tick ~= nil then data.tick("global") end

    end)

end



function competitionMain(dt) safe_main(competition, dt, "competition") end

function competitionShow() competition.on_open() end

function competitionHide() competition.on_close() end



function profileMain(dt) safe_main(profile, dt, "profile") end

function profileShow() profile.on_open() end

function profileHide() profile.on_close() end



function battleMain(dt) safe_main(battle, dt, "battle") end

function battleShow() battle.on_open() end

function battleHide() battle.on_close() end
