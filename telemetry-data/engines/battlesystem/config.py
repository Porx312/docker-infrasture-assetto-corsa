import os

# ── Arming / pair lock ──
BATTLE_ARM_MAX_GAP_METERS = float(os.getenv("BATTLE_ARM_MAX_GAP_METERS", "15.0"))
BATTLE_ARM_MIN_SPEED_KMH = float(os.getenv("BATTLE_ARM_MIN_SPEED_KMH", "40.0"))
ARM_SUSTAINED_PROXIMITY_SEC = float(
    os.getenv("BATTLE_ARM_SUSTAINED_PROXIMITY_SEC", "5.0")
)
# Legacy aliases used by orchestrator imports
PAIR_LOCK_MAX_DISTANCE_METERS = BATTLE_ARM_MAX_GAP_METERS
PAIR_LOCK_MIN_SPEED_KMH = BATTLE_ARM_MIN_SPEED_KMH

MAX_BATTLE_GAP_METERS = float(os.getenv("MAX_BATTLE_GAP_METERS", "80.0"))
PRESTART_GAP_ABORT_GRACE_SEC = float(os.getenv("BATTLE_PRESTART_GAP_ABORT_GRACE_SEC", "2.0"))
GAP_ABORT_MIN_BOTH_SPEED_KMH = float(os.getenv("BATTLE_GAP_ABORT_MIN_BOTH_SPEED_KMH", "20.0"))
LAUNCH_TIMEOUT_SEC = float(os.getenv("BATTLE_LAUNCH_TIMEOUT_SEC", "8.0"))
ARMED_CHAT_COOLDOWN_SEC = float(os.getenv("BATTLE_ARMED_CHAT_COOLDOWN_SEC", "15.0"))
FINISHED_COOLDOWN_SEC = float(os.getenv("BATTLE_FINISHED_COOLDOWN_SEC", "20.0"))

# ── Run end / scoring ──
# Lap ends when the lead crosses the finish line (spline wrap), not at 100% of the track
# from spline 0 — works when the battle starts mid-lap.
FINISH_LINE_HIGH_SPLINE = float(os.getenv("BATTLE_FINISH_LINE_HIGH_SPLINE", "0.90"))
FINISH_LINE_LOW_SPLINE = float(os.getenv("BATTLE_FINISH_LINE_LOW_SPLINE", "0.10"))
MIN_LAP_PROGRESS_BEFORE_FINISH = float(
    os.getenv(
        "BATTLE_MIN_LAP_PROGRESS_BEFORE_FINISH",
        os.getenv("RUN_END_SPLINE_FRACTION", "0.30"),
    )
)
# Legacy alias (was misread as “100% of track”; now only minimum progress before finish counts).
RUN_END_SPLINE_FRACTION = MIN_LAP_PROGRESS_BEFORE_FINISH
FINISH_POINT_MIN_GAP_METERS = float(os.getenv("BATTLE_FINISH_POINT_MIN_GAP_METERS", "20.0"))
DISAPPEAR_GAP_METERS = float(os.getenv("BATTLE_DISAPPEAR_GAP_METERS", "250.0"))
# Opponent in pits / stopped: abandon after this many seconds below GAP_ABORT speed (any 3D gap).
ABANDON_STALL_SEC = float(os.getenv("BATTLE_ABANDON_STALL_SEC", "5.0"))
# At 0-0 abandon: award win only if max driven_spline of the pair >= this (fraction of lap since GO).
ABANDON_MIN_PROGRESS_FOR_WIN = float(
    os.getenv("BATTLE_ABANDON_MIN_PROGRESS_FOR_WIN", "0.10")
)
# Fallback when track spline is missing: minimum 3D distance driven since GO (meters).
ABANDON_MIN_PROGRESS_METERS = float(
    os.getenv("BATTLE_ABANDON_MIN_PROGRESS_METERS", "200.0")
)
# Spline health: mark unreliable when moving but NormalizedPosition stuck or zero.
SPLINE_STUCK_EPS = float(os.getenv("BATTLE_SPLINE_STUCK_EPS", "0.0001"))
SPLINE_STUCK_SEC = float(os.getenv("BATTLE_SPLINE_STUCK_SEC", "2.0"))
SPLINE_STUCK_MIN_SPEED_KMH = float(
    os.getenv(
        "BATTLE_SPLINE_STUCK_MIN_SPEED_KMH",
        str(min(25.0, BATTLE_ARM_MIN_SPEED_KMH)),
    )
)
# Position-mode launch: assign lead/chase quickly when track spline is unavailable.
POSITION_ROLE_ASSIGN_WAIT_SEC = float(
    os.getenv("BATTLE_POSITION_ROLE_ASSIGN_WAIT_SEC", "0.5")
)
SPLINE_MIN_MOVE_METERS = float(os.getenv("BATTLE_SPLINE_MIN_MOVE_METERS", "5.0"))
POSITION_AHEAD_MIN_METERS = float(os.getenv("BATTLE_POSITION_AHEAD_MIN_METERS", "2.0"))
# Splines at or below this are treated as missing (touge without fast_lane.ai).
SPLINE_INVALID_EPS = float(os.getenv("BATTLE_SPLINE_INVALID_EPS", "0.001"))
# When gap >= disappear: lead faster than chase by this margin → lead left the battle (chase wins).
ABANDON_PULLAWAY_SPEED_DELTA_KMH = float(os.getenv("BATTLE_ABANDON_PULLAWAY_SPEED_DELTA_KMH", "15.0"))

# ── Overtake / recovery ──
OVERTAKE_POINT_COOLDOWN_SEC = float(os.getenv("OVERTAKE_POINT_COOLDOWN_SEC", "2.0"))
OVERTAKE_MIN_GAP_METERS = float(os.getenv("OVERTAKE_MIN_GAP_METERS", "10.0"))
OVERTAKE_MAX_GAP_METERS = float(os.getenv("OVERTAKE_MAX_GAP_METERS", "15.0"))
OVERTAKE_MAX_GAP_FALLBACK_METERS = float(
    os.getenv("BATTLE_OVERTAKE_MAX_GAP_FALLBACK_METERS", "20.0")
)
OVERTAKE_MARGIN_SPLINE = float(os.getenv("BATTLE_OVERTAKE_MARGIN_SPLINE", "0.005"))
# Smaller threshold to detect a pass while cars are still within 15 m (0.005 ≈ 25 m on a 5 km lap).
OVERTAKE_PASS_MARGIN_SPLINE = float(os.getenv("BATTLE_OVERTAKE_PASS_MARGIN_SPLINE", "0.0003"))
OVERTAKE_ACTIVE_GRACE_SEC = float(os.getenv("BATTLE_OVERTAKE_ACTIVE_GRACE_SEC", "2.0"))

# Role assignment at launch (first run only)
ROLE_ASSIGN_MIN_GAP_SPLINE = float(os.getenv("BATTLE_ROLE_ASSIGN_MIN_GAP_SPLINE", "0.0006"))
ROLE_ASSIGN_WAIT_SEC = float(os.getenv("BATTLE_ROLE_ASSIGN_WAIT_SEC", "6.0"))

# ── Pair lifecycle ──
PAIR_STICKY_TIMEOUT_SEC = float(os.getenv("BATTLE_PAIR_STICKY_TIMEOUT_SEC", "20.0"))
