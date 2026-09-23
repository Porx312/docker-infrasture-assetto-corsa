--[[ ARM 5→1 charging bar — smooth fill toward server progress (no velocity prediction). ]]

local arming_anim = {}

local SMOOTH_HZ = 15

local anim = {
    display_progress = 0,
}

local function clamp(v, lo, hi)
    return math.max(lo, math.min(hi, v))
end

function arming_anim.reset()
    anim.display_progress = 0
end

function arming_anim.tick(dt, target_progress)
    target_progress = clamp(tonumber(target_progress) or 0, 0, 1)
    dt = math.max(0, tonumber(dt) or 0)

    if dt > 0 then
        local alpha = 1 - math.exp(-dt * SMOOTH_HZ)
        anim.display_progress = anim.display_progress + (target_progress - anim.display_progress) * alpha
    else
        anim.display_progress = target_progress
    end

    anim.display_progress = clamp(anim.display_progress, 0, 1)
    return anim.display_progress
end

return arming_anim
