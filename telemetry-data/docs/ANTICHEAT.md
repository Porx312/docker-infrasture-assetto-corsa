# ACSP Anticheat (telemetry-data)

Observe-only module that inspects **parsed ACSP plugin UDP fields** already handled by `telemetry-data`. It does **not** read client shared memory, inputs, setups, or physics mods, and it **never kicks or bans** unless you deliberately enable a future sanctions path (hard-disabled by default).

## What it can see

| Source | Fields used | Units (as used in this codebase) |
|--------|-------------|----------------------------------|
| `CAR_UPDATE` (53) | `pos_x/y/z`, `v_x/y/z`, `spline` | pos ≈ meters; vel m/s; spline NormalizedPosition ≈ [0, 1] |
| `LAP_COMPLETED` (73) | `lap_time_ms`, `cuts` | milliseconds; cut count |
| Join / leave | Steam `guid`, `car_id` | session lifecycle |

**Not available / not claimed:** sector times (leaderboard not parsed), gear/rpm (parsed then discarded by handlers today), client memory cheats, grip multipliers, input macros.

**Timing caveat:** intervals use a **monotonic reception clock**. That is not the exact physics tick time on `acServer`. UDP can drop, delay, or reorder packets.

## Taxonomy

1. **Invalid packet** — bad types / ids (rejected; no state update).
2. **Unusable sample** — NaN/Inf, gap too large, Δt ≤ 0 / out-of-order, Δt below minimum. **No kinematic evidence** from that interval. Baseline is refreshed so the next interval is clean.
3. **Suspicious anomaly** — a detector fired (speed ceiling, position jump, accel spike, spline range, lap cuts/time).
4. **Persistent evidence** — risk score (with decay) crossed `evidence_score_threshold`. Intended for **human review**, not auto-punishment. Multiple detectors on the **same sample** contribute **once** (max severity weight).

## Enable / configure

Defaults (safe):

- `ANTICHEAT_ENABLED=false`
- `ANTICHEAT_MODE=observe`
- `ANTICHEAT_SANCTIONS_ENABLED=false`

Even if `ANTICHEAT_MODE=enforce`, **sanctions stay off** unless `ANTICHEAT_SANCTIONS_ENABLED=true` **and** mode is `enforce`. The module still has **no kick/ban calls**; `maybe_sanction()` is an explicit no-op.

Useful env overrides:

| Variable | Meaning |
|----------|---------|
| `ANTICHEAT_MAX_SPEED_KMH` | Speed ceiling (default 450) |
| `ANTICHEAT_MIN_DT_SEC` / `ANTICHEAT_MAX_DT_SEC` | Usable kinematic window (default 0.001–0.5 s) |
| `ANTICHEAT_POSITION_JUMP_MARGIN_M` | Absolute position slack |
| `ANTICHEAT_POSITION_JUMP_SPEED_FACTOR` | Multiplier on ‖v‖·Δt envelope |
| `ANTICHEAT_MAX_ACCEL_MS2` | \|Δ‖v‖\|/Δt ceiling (default 80) |
| `ANTICHEAT_EVIDENCE_SCORE_THRESHOLD` | Score for evidence emission (default 12) |
| `ANTICHEAT_SINK_QUEUE_SIZE` | Bounded evidence queue (drop newest when full) |

File defaults: [`anticheat/config.default.json`](../anticheat/config.default.json). Invalid/missing config → hard-coded safe defaults + warning logs.

## Integration points

Hooks (no-op when disabled) in:

- `core/handlers/car_update.py`
- `core/handlers/lap_completed.py`
- `core/handlers/new_connection.py`
- `core/handlers/connection_closed.py`

State key: `(server_folder_id | display name | port, steam guid)`. Same local `car_id` on two servers does not share state. Disconnect clears the session completely.

## Calibration tips

1. Leave **disabled** in production until you review logs from a busy practice session with `ANTICHEAT_ENABLED=true`.
2. If position jumps fire on packet loss, **widen** `ANTICHEAT_MAX_DT_SEC` or margins — do not lower evidence threshold.
3. Accel spikes often follow collisions; keep `max_accel_ms2` high and require score accumulation.
4. Treat a single anomaly as **noise**. Evidence threshold defaults require multiple high-severity hits (or sustained medium) within the decay window.
5. Never treat this as proof of memory/physics manipulation.

## Sink / metrics

- Hot path: synchronous detectors + scoring; `enqueue` is non-blocking.
- On queue saturation: drop + `sink_dropped` metric + periodic warning log.
- When enabled, a daemon worker drains to structured log lines (`anticheat_evidence ...`).
- In-process counters: `engine.metrics.snapshot()`.

## Tests

```bash
cd telemetry-data
pytest tests/anticheat -q
pytest -q
```
