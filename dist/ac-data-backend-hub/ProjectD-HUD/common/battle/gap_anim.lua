--[[ Battle gap indicator — smooth fill 0..max toward polled snapshots. ]]

local gap_anim = {}

local SMOOTH_HZ = 11
local METERS_SMOOTH_HZ = 11
local PREDICT_MAX_SEC = 0
local MAX_METERS_PER_SEC = 40
local VELOCITY_EMA = 0.3
local MAX_RATIO_DELTA_PER_SEC = 0.15

local anim = {
    display_ratio = 0,
    display_meters = 0,
    target_meters = 0,
    predicted_meters = 0,
    target_ratio = 0,
    velocity_mps = 0,
    opponent_ahead = nil,
    has_role = false,
    battle_id = "",
    last_target_meters = 0,
    last_target_clock = 0,
    max_m = 250,
}

local function clamp(v, lo, hi)
    return math.max(lo, math.min(hi, v))
end

local function rate_limit(current, desired, max_delta)
    local delta = desired - current
    if delta > max_delta then
        return current + max_delta
    end
    if delta < -max_delta then
        return current - max_delta
    end
    return desired
end

function gap_anim.reset()
    anim.display_ratio = 0
    anim.display_meters = 0
    anim.target_meters = 0
    anim.predicted_meters = 0
    anim.target_ratio = 0
    anim.velocity_mps = 0
    anim.opponent_ahead = nil
    anim.has_role = false
    anim.battle_id = ""
    anim.last_target_meters = 0
    anim.last_target_clock = 0
    anim.max_m = 250
end

function gap_anim.set_battle_id(battle_id)
    battle_id = tostring(battle_id or "")
    if battle_id == anim.battle_id then return end
    anim.battle_id = battle_id
    anim.display_ratio = 0
    anim.display_meters = 0
    anim.target_meters = 0
    anim.predicted_meters = 0
    anim.target_ratio = 0
    anim.velocity_mps = 0
    anim.opponent_ahead = nil
    anim.has_role = false
    anim.last_target_meters = 0
    anim.last_target_clock = 0
end

function gap_anim.set_target(signed, max_m, opponent_ahead, gap_m)
    max_m = math.max(1, tonumber(max_m) or 250)
    anim.max_m = max_m

    local abs_m = math.max(0, tonumber(gap_m) or 0)
    if abs_m <= 0 then
        abs_m = math.abs(tonumber(signed) or 0)
    end

    local now = os.clock()
    if anim.last_target_clock > 0 and abs_m ~= anim.last_target_meters then
        local dt = now - anim.last_target_clock
        if dt > 0.02 and dt < 5.0 then
            local raw_vel = (abs_m - anim.last_target_meters) / dt
            anim.velocity_mps = anim.velocity_mps + (raw_vel - anim.velocity_mps) * VELOCITY_EMA
        end
    end
    anim.last_target_meters = abs_m
    anim.last_target_clock = now

    anim.target_meters = abs_m
    anim.target_ratio = clamp(abs_m / max_m, 0, 1)
    anim.opponent_ahead = opponent_ahead
    anim.has_role = opponent_ahead ~= nil
end

local function predicted_target_meters(now)
    local base = anim.target_meters
    if PREDICT_MAX_SEC <= 0 or anim.last_target_clock <= 0 then
        return base
    end
    local elapsed = math.max(0, now - anim.last_target_clock)
    if elapsed <= 0 then
        return base
    end
    local predict_sec = math.min(elapsed, PREDICT_MAX_SEC)
    local vel = clamp(anim.velocity_mps, -MAX_METERS_PER_SEC, MAX_METERS_PER_SEC)
    return clamp(base + vel * predict_sec, 0, anim.max_m)
end

function gap_anim.tick(dt, signed, max_m, opponent_ahead, battle_id, gap_m)
    dt = math.max(0, tonumber(dt) or 0)
    gap_anim.set_battle_id(battle_id)
    gap_anim.set_target(signed, max_m, opponent_ahead, gap_m)

    local now = os.clock()
    anim.predicted_meters = predicted_target_meters(now)
    local predicted_ratio = clamp(anim.predicted_meters / anim.max_m, 0, 1)

    if dt > 0 then
        local alpha = 1 - math.exp(-dt * SMOOTH_HZ)
        local desired_ratio = anim.display_ratio + (predicted_ratio - anim.display_ratio) * alpha
        local max_ratio_step = MAX_RATIO_DELTA_PER_SEC * dt
        anim.display_ratio = rate_limit(anim.display_ratio, desired_ratio, max_ratio_step)

        local meters_alpha = 1 - math.exp(-dt * METERS_SMOOTH_HZ)
        local desired_meters = anim.display_meters + (anim.predicted_meters - anim.display_meters) * meters_alpha
        local max_meters_step = MAX_RATIO_DELTA_PER_SEC * anim.max_m * dt
        anim.display_meters = rate_limit(anim.display_meters, desired_meters, max_meters_step)
    else
        anim.display_ratio = predicted_ratio
        anim.display_meters = anim.predicted_meters
    end

    anim.display_ratio = clamp(anim.display_ratio, 0, 1)
    anim.display_meters = clamp(anim.display_meters, 0, anim.max_m)

    return {
        display_ratio = anim.display_ratio,
        display_meters = anim.display_meters,
        target_ratio = anim.target_ratio,
        opponent_ahead = anim.opponent_ahead,
        has_role = anim.has_role,
        max_m = anim.max_m,
        velocity_mps = anim.velocity_mps,
    }
end

return gap_anim
