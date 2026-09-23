--[[
    Datos falsos — Initial D cast.
    Tier 0–10 según nivel en el anime (touge / downhill).
]]

local mock = {}

mock.MOCK_CONTEXT = {
    server_id = "projectd-touge-01",
    track_id = "akina",
    track_name = "Akina",
    layout_id = "downhill",
    layout_name = "Downhill",
    car_id = "ae86_trueno",
    car_name = "Trueno AE86",
    player_steam_id = "76561198012345678",
}

local function avatar(name)
    local seed = string.gsub(name, "%s+", "")
    return "https://api.dicebear.com/7.x/notionists/png?seed=" .. seed .. "&size=128"
end

local RIVAL_ABOVE = {
    rank = 1,
    name = "Ryosuke Takahashi",
    tier = 10,
    lap_ms = 277800,
    car_name = "RX-7 FC",
    avatar_url = avatar("Ryosuke Takahashi"),
}

local RIVAL_BELOW = {
    rank = 3,
    name = "Keisuke Takahashi",
    tier = 9,
    lap_ms = 281200,
    car_name = "RX-7 FD",
    avatar_url = avatar("Keisuke Takahashi"),
}

local RIVAL_RANK_4 = {
    rank = 4,
    name = "Itsuki Takeuchi",
    tier = 6,
    lap_ms = 285400,
    car_name = "Silvia S13",
    avatar_url = avatar("Itsuki Takeuchi"),
}

local RIVAL_BELOW_ALT = {
    rank = 3,
    name = "Itsuki Takeuchi",
    tier = 6,
    lap_ms = 285400,
    car_name = "Silvia S13",
    avatar_url = avatar("Itsuki Takeuchi"),
}

local function rival_below_override()
    local key = string.lower(tostring(ac.storage("ProjectD-HUD:competition_mock_rival_below", "keisuke"):get()))
    if key == "itsuki" then return RIVAL_BELOW_ALT end
    if key == "none" or key == "0" or key == "" then return nil end
    return RIVAL_BELOW
end

local function rivals_for_rank(rank)
    rank = tonumber(rank) or 2
    if rank <= 1 then
        return {
            above = nil,
            below = {
                rank = 2,
                name = "Takumi Fujiwara",
                tier = 9,
                lap_ms = 279650,
                car_name = "Trueno AE86",
                avatar_url = avatar("Takumi Fujiwara"),
            },
        }
    end
    if rank == 2 then
        return { above = RIVAL_ABOVE, below = rival_below_override() }
    end
    if rank == 3 then
        return {
            above = {
                rank = 2,
                name = "Takumi Fujiwara",
                tier = 9,
                lap_ms = 279650,
                car_name = "Trueno AE86",
                avatar_url = avatar("Takumi Fujiwara"),
            },
            below = RIVAL_RANK_4,
        }
    end
    return {
        above = RIVAL_BELOW,
        below = nil,
    }
end

local PROFILES = {
    ["76561198012345678"] = {
        name = "PORX◆◆◆",
        rank = 2,
        tier = 9,
        best_lap_ms = 279650,
        avatar_url = avatar("Takumi Fujiwara"),
        elo = 1380,
        rivals = {
            above = RIVAL_ABOVE,
            below = RIVAL_BELOW,
        },
    },
}

--- One preset per effect for offline HUD parity checks.
--- ac.storage("ProjectD-HUD:display_mock_effect", "solid"|"gradient"|"taillight"|"speed"|"decal"|"chrome"|"minecraft")
local DISPLAY_STYLE_PRESETS = {
    solid = {
        fontId = "bebas",
        effectId = "solid",
        color = "#FFFFFF",
        weight = "regular",
    },
    gradient = {
        fontId = "orbitron",
        effectId = "gradient",
        color = "#FF6B6B",
        gradientColor = "#FFD93D",
        weight = "bold",
    },
    taillight = {
        fontId = "rajdhani",
        effectId = "taillight",
        color = "#22C55E",
        weight = "bold",
    },
    speed = {
        fontId = "orbitron",
        effectId = "speed",
        color = "#38BDF8",
        weight = "bold",
    },
    decal = {
        fontId = "permanent_marker",
        effectId = "decal",
        color = "#FACC15",
        weight = "regular",
    },
    chrome = {
        fontId = "cinzel",
        effectId = "chrome",
        color = "#E5E7EB",
        weight = "bold",
    },
    minecraft = {
        fontId = "minecraft_ten",
        effectId = "solid",
        color = "#FFFFFF",
        weight = "regular",
    },
}

local function mock_display_style_preset()
    local key = string.lower(tostring(ac.storage("ProjectD-HUD:display_mock_effect", "gradient"):get()))
    return DISPLAY_STYLE_PRESETS[key] or DISPLAY_STYLE_PRESETS.gradient
end

local function slot_from_rival(entry)
    if entry == nil then return nil end
    return {
        rank = entry.rank,
        name = entry.name,
        tier = entry.tier,
        lap_ms = entry.lap_ms,
        car_name = entry.car_name,
        avatar_url = entry.avatar_url,
    }
end

function mock.get_context()
    return mock.MOCK_CONTEXT
end

function mock.get_player_profile()
    local ctx = mock.MOCK_CONTEXT
    local p = PROFILES[ctx.player_steam_id]
    if p == nil then return nil end

    return {
        name = p.name,
        rank = p.rank,
        tier = p.tier,
        best_lap_ms = p.best_lap_ms,
        car_name = ctx.car_name,
        car_id = ctx.car_id,
        avatar_url = p.avatar_url,
        steam_id = ctx.player_steam_id,
        elo = p.elo,
        rival = p.rivals and p.rivals.above or nil,
        rivals = p.rivals,
        display_style = mock_display_style_preset(),
    }
end

function mock.tick() end

function mock.is_account_restricted()
    return false
end

function mock.get_status_message(kind)
    if kind == "profile" or kind == "competition" then return nil end
    return "No data"
end

function mock.get_competition_ladder(_car_filter)
    local player = mock.get_player_profile()
    if player == nil then
        return { slots = {}, player_rank = 0, profile = nil }
    end

    local rank = tonumber(player.rank) or 0
    local mock_rank = tonumber(ac.storage("ProjectD-HUD:competition_mock_rank", 0):get()) or 0
    if mock_rank > 0 then
        rank = mock_rank
    end

    local rivals = rivals_for_rank(rank)
    local center = {
        rank = rank,
        name = player.name,
        tier = player.tier,
        lap_ms = player.best_lap_ms,
        car_name = player.car_name,
        avatar_url = player.avatar_url,
        is_self = true,
        display_style = player.display_style,
        frame_url = player.frame_url,
    }

    return {
        slots = {
            [0] = slot_from_rival(rivals.above),
            [1] = center,
            [2] = slot_from_rival(rivals.below),
        },
        player_rank = rank,
        profile = player,
    }
end

--- Battle HUD mock — ac.storage("ProjectD-HUD:battle_mock_state", "matchmaking"|"vs"|"countdown"|"active"|"lead"|"chase"|"cancelled"|"result"|"draw")
local battle_parse = require("common.api.battle_parse")

local MOCK_ARM_SEC = 5.0
local mock_arm_clock_start = nil

local function with_battle_display(battle)
    if battle == nil then return nil end
    return battle_parse.attach_display(battle)
end

function mock.get_battle()
    local key = string.lower(tostring(ac.storage("ProjectD-HUD:battle_mock_state", "active"):get()))
    if key ~= "countdown" then
        mock_arm_clock_start = nil
    end
    local left_style = mock_display_style_preset()
    local player_left = {
        name = "PORX◆◆◆",
        car_name = "rx7",
        tier = 10,
        elo = 1450,
        avatar_url = avatar("Ryosuke Takahashi"),
        role = "lead",
        display_style = left_style,
    }
    local player_right = {
        name = "Takumi",
        car_name = "ae86",
        tier = 10,
        elo = 1380,
        avatar_url = avatar("Takumi Fujiwara"),
        role = "chase",
        display_style = {
            fontId = "bebas",
            effectId = "solid",
            color = "#FFFFFF",
            weight = "regular",
        },
    }

    if key == "matchmaking" then
        return with_battle_display({
            state = "pairing",
            looking_for_opponent = true,
            center_text = "MATCHMAKING",
            mode = "LOOKING",
            player_left = player_left,
            player_right = { placeholder = true },
        })
    end

    if key == "vs" then
        return with_battle_display({
            state = "armed",
            center_text = "VS",
            mode = "ARMED",
            show_prep_scores = true,
            score_left = 0,
            score_right = 0,
            player_left = player_left,
            player_right = player_right,
        })
    end

    if key == "countdown" then
        if mock_arm_clock_start == nil then
            mock_arm_clock_start = os.clock()
        end
        local elapsed = os.clock() - mock_arm_clock_start
        local remaining = math.max(0, MOCK_ARM_SEC - elapsed)
        local progress = math.min(1, elapsed / MOCK_ARM_SEC)
        local cd = remaining <= 0 and 0 or math.max(1, math.ceil(remaining))
        return with_battle_display({
            state = "arming",
            arming_countdown = cd,
            center_text = cd > 0 and tostring(cd) or "GO!",
            mode = cd > 0 and tostring(cd) or "GO!",
            arm_proximity_since = os.time() - elapsed,
            arming_progress = progress,
            arming_remaining_sec = remaining,
            countdown_hint = "CONTINUE: MAINTAIN  ·  CANCEL: BREAK FORMATION",
            player_left = player_left,
            player_right = player_right,
        })
    end

    if key == "cancelled" then
        return with_battle_display({
            state = "cancelled",
            status = "cancelled",
            center_text = "CANCELLED",
            mode = "CANCELLED",
            end_label = "FORMATION BROKEN",
            event_label = "FORMATION BROKEN",
            player_left = player_left,
            player_right = player_right,
        })
    end

    if key == "result" then
        return with_battle_display({
            state = "finished",
            status = "finished",
            center_text = "WINNER",
            score_left = 1,
            score_right = 0,
            winner_name = player_left.name,
            winner_player = {
                name = player_left.name,
                tier = player_left.tier,
                avatar_url = player_left.avatar_url,
                car_name = player_left.car_name,
                display_style = player_left.display_style,
                frame_url = player_left.frame_url,
            },
            final_score_text = "1-0",
            player_left = player_left,
            player_right = player_right,
        })
    end

    if key == "draw" then
        return with_battle_display({
            state = "finished",
            status = "draw",
            center_text = "DRAW",
            score_left = 0,
            score_right = 0,
            player_left = player_left,
            player_right = player_right,
        })
    end

    if key == "lead" then
        local lead_left = {
            name = "Takumi",
            car_name = "ae86",
            tier = 10,
            elo = 1380,
            avatar_url = avatar("Takumi Fujiwara"),
            role = "lead",
            ahead_on_track = true,
            display_style = player_right.display_style,
        }
        return with_battle_display({
            state = "active",
            center_text = "LEAD",
            mode = "LEAD",
            score_left = 1,
            score_right = 0,
            show_scores = true,
            show_gap = true,
            gap = { current = 42, max = 200, signed = 42, opponent_ahead = false },
            gap3d_m = 42,
            disappear_gap_m = 200,
            player_left = lead_left,
            player_right = player_right,
        })
    end

    if key == "chase" then
        local chase_left = {
            name = "Takumi",
            car_name = "ae86",
            tier = 10,
            elo = 1380,
            avatar_url = avatar("Takumi Fujiwara"),
            role = "chase",
            ahead_on_track = false,
            display_style = player_right.display_style,
        }
        return with_battle_display({
            state = "active",
            center_text = "CHASE",
            mode = "CHASE",
            score_left = 0,
            score_right = 1,
            show_scores = true,
            show_gap = true,
            gap = { current = 88, max = 200, signed = -88, opponent_ahead = true },
            gap3d_m = 88,
            disappear_gap_m = 200,
            player_left = chase_left,
            player_right = player_right,
        })
    end

    return with_battle_display({
        state = "active",
        center_text = "LEAD",
        mode = "LEAD",
        score_left = 2,
        score_right = 1,
        show_scores = true,
        show_gap = true,
        gap = { current = 125, max = 200, signed = 125, opponent_ahead = false },
        gap3d_m = 125,
        disappear_gap_m = 200,
        event_label = "OVERTAKE +1",
        player_left = player_left,
        player_right = player_right,
    })
end

return mock
