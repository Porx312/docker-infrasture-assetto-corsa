--[[ Battle HUD — player avatars, tier chips, name/car labels. ]]

local theme = require("common.theme")
local layout = require("common.layout")
local images = require("common.images")
local profile = require("common.api.profile")
local display_style = require("common.display_style")
local shared = require("common.draw.shared")
local draw_text = require("common.draw_text")

local draw_battle_players = {}

local function profile_car_name(player)
    if player == nil then return "" end
    return theme.format_car_label(player.car_name, player.car_id)
end

local function draw_beside_avatar_text(avatar_o, aw, side, player, name, car, m)
    local gap = m.text_avatar_gap
    local name_fs = m.name_fs
    local car_fs = m.car_fs

    local name_sz = display_style.measure_styled_name(player.display_style, name, name_fs, {
        hud_context = display_style.HUD_CONTEXT_BATTLE,
    })
    name_sz = select(1, name_sz) or vec2(0, name_fs)
    local car_block = car_fs * 1.05
    local block_h = name_sz.y + m.name_car_gap + car_block
    local top_y = avatar_o.y + aw * 0.5 - block_h * 0.5

    if side == "left" then
        local tx = shared.avatar_identity_text_x(avatar_o, aw, "left", gap)
        name, name_fs = display_style.draw_hud_name_label(
            player.display_style,
            name,
            vec2(tx, top_y),
            name_fs,
            { prepared = true, hud_context = display_style.HUD_CONTEXT_BATTLE }
        )
        local measured = display_style.measure_styled_name(player.display_style, name, name_fs, {
            hud_context = display_style.HUD_CONTEXT_BATTLE,
        })
        local name_h = (select(1, measured) or vec2(0, name_fs)).y
        draw_text.anchored(
            car,
            car_fs,
            vec2(tx, top_y + name_h + m.name_car_gap),
            "left",
            theme.colors.rival_tag,
            theme.fonts.medium
        )
    else
        local tx = shared.avatar_identity_text_x(avatar_o, aw, "right", gap)
        name, name_fs = display_style.draw_hud_name_label(
            player.display_style,
            name,
            vec2(tx, top_y),
            name_fs,
            { prepared = true, anchor = "right", hud_context = display_style.HUD_CONTEXT_BATTLE }
        )
        local measured = display_style.measure_styled_name(player.display_style, name, name_fs, {
            hud_context = display_style.HUD_CONTEXT_BATTLE,
        })
        local name_h = (select(1, measured) or vec2(0, name_fs)).y
        draw_text.anchored(
            car,
            car_fs,
            vec2(tx, top_y + name_h + m.name_car_gap),
            "right",
            theme.colors.rival_tag,
            theme.fonts.medium
        )
    end
end

local function format_elo_text(elo)
    local n = tonumber(elo)
    if n == nil or n <= 0 then return "—" end
    return tostring(math.floor(n + 0.5))
end

local function draw_avatar_stats_chip(circle_o, circle_sz, side, player, m)
    if circle_o == nil then return end
    theme.ensure_fonts()

    local tier = profile.tier_for_display(player)
    local elo_text = format_elo_text(player.elo)
    local tier_sz = m.chip_tier_sz
    local elo_fs = m.chip_elo_fs
    local pad = m.chip_pad
    local gap = m.chip_inner_gap

    ui.pushDWriteFont(theme.fonts.medium)
    local elo_w = draw_text.measure(theme.fonts.medium, elo_text, elo_fs)
    ui.popDWriteFont()

    local row_h = math.max(tier_sz, elo_fs)
    local chip_h = row_h + pad * 2
    local tier_block = tier_sz + gap
    local chip_w = pad + tier_block + elo_w + pad
    local chip_o = layout.battle_avatar_chip_origin(circle_o, circle_sz, side, chip_w, chip_h, m.scale)
    local radius = math.max(m.chip_radius, chip_h * 0.45)

    ui.drawRectFilled(
        chip_o,
        chip_o + vec2(chip_w, chip_h),
        rgbm(0, 0, 0, 0.85),
        radius,
        layout.corners_all()
    )

    local tier_y = pad + (row_h - tier_sz) * 0.5
    local elo_y = pad + (row_h - elo_fs) * 0.5

    images.draw_tier_badge(chip_o + vec2(pad, tier_y), tier, tier_sz)
    draw_text.anchored(
        elo_text,
        elo_fs,
        vec2(chip_o.x + pad + tier_block, chip_o.y + elo_y),
        "left",
        theme.colors.white,
        theme.fonts.medium
    )
end

function draw_battle_players.draw_player(panel_o, panel_size, player, side, m, d)
    theme.ensure_fonts()
    player = player or {}

    if player.placeholder == true then
        return
    end

    local avatar_slot = side == "left" and d.left_avatar or d.right_avatar
    layout.battle_slot(panel_o, panel_size, avatar_slot)

    local url = images.resolve_url(player.name, player.avatar_url)
    local circle_o, circle_sz = layout.battle_avatar_circle(panel_o, panel_size, side)
    shared.avatar_with_frame(circle_o, url, player.frame_url, circle_sz, nil, shared.FRAME_SCALE_BATTLE)
    draw_avatar_stats_chip(circle_o, circle_sz, side, player, m)

    local name = display_style.hud_name_text(player.name, player.display_style)
    local car = profile_car_name(player)
    draw_beside_avatar_text(circle_o, circle_sz, side, player, name, car, m)
end

function draw_battle_players.draw_searching_overlay(panel_o, panel_size, show)
    if not show then return end
    local tex = images.get_battle_searching_overlay()
    if tex == nil then return end
    local origin, size = layout.battle_searching_rect(panel_o, panel_size)
    ui.drawImage(tex, origin, origin + size, rgbm(1, 1, 1, 1))
end

return draw_battle_players
