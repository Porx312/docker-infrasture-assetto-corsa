"""Anticheat engine — synchronous, bounded, no blocking I/O."""

from __future__ import annotations

from typing import Any, List, Optional, Tuple

from anticheat.clock import MonotonicClock, SystemMonotonicClock
from anticheat.config import AnticheatConfig, ConfigLoadResult, load_config
from anticheat.detectors import run_car_detectors, run_lap_detectors
from anticheat.detectors.validity import speed_ms_from_vel, validate_car_fields
from anticheat.metrics import AnticheatMetrics
from anticheat.scoring import apply_anomalies
from anticheat.sink import BoundedEvidenceSink
from anticheat.state import StateStore
from anticheat.types import (
    CarSample,
    EvidenceEvent,
    LapSample,
    SampleDisposition,
    TickResult,
    Vec3,
)


class AnticheatEngine:
    """Process CAR_UPDATE / LAP / join / leave samples.

    Never kicks or bans. Sanctions path is a hard no-op unless
    ``config.sanctions_allowed()`` (disabled by default).
    """

    def __init__(
        self,
        config: AnticheatConfig,
        *,
        clock: Optional[MonotonicClock] = None,
        sink: Optional[BoundedEvidenceSink] = None,
        config_warnings: Optional[List[str]] = None,
    ) -> None:
        self.config = config
        self.clock: MonotonicClock = clock or SystemMonotonicClock()
        self.metrics = AnticheatMetrics()
        self.config_warnings = list(config_warnings or [])
        self.store = StateStore(ring_buffer_size=config.ring_buffer_size)
        if sink is not None:
            self.sink = sink
        else:
            self.sink = BoundedEvidenceSink(
                maxsize=config.sink_queue_size,
                drop_log_every=config.sink_drop_log_every,
                start_worker=False,
            )

    # ── lifecycle ──────────────────────────────────────────────────────

    def on_join(self, server_key: str, guid: str, car_id: int = 0) -> None:
        if not self.config.enabled:
            return
        if not server_key or not guid:
            return
        # Fresh session: ensure no leftover (reconnect after incomplete leave)
        self.store.remove(server_key, guid)
        self.store.get_or_create(server_key, guid, car_id)

    def on_leave(self, server_key: str, guid: str) -> None:
        if not self.config.enabled:
            return
        if self.store.remove(server_key, guid):
            self.metrics.leaves_cleared += 1

    # ── CAR_UPDATE ────────────────────────────────────────────────────

    def on_car_update(
        self,
        *,
        server_key: str,
        guid: str,
        car_id: int,
        pos: Vec3,
        vel: Vec3,
        spline: float,
        recv_mono: Optional[float] = None,
    ) -> TickResult:
        self.metrics.samples_total += 1
        if not self.config.enabled:
            self.metrics.samples_disabled += 1
            return TickResult(disposition=SampleDisposition.OK, disabled=True)

        reason = validate_car_fields(pos, vel, spline, car_id, server_key, guid)
        if reason is not None:
            if reason.startswith("invalid_"):
                self.metrics.samples_invalid += 1
                return TickResult(
                    disposition=SampleDisposition.INVALID_PACKET,
                    unusable_reason=reason,
                )
            # NaN/Inf: do not contaminate state or scoring
            self.metrics.inc_unusable(reason)
            return TickResult(
                disposition=SampleDisposition.UNUSABLE,
                unusable_reason=reason,
            )

        now = float(recv_mono) if recv_mono is not None else self.clock.monotonic()
        sample_id = self.store.allocate_sample_id()
        state = self.store.get_or_create(server_key, guid, car_id)
        sample = CarSample(
            server_key=server_key,
            guid=guid,
            car_id=car_id,
            pos=(float(pos[0]), float(pos[1]), float(pos[2])),
            vel=(float(vel[0]), float(vel[1]), float(vel[2])),
            spline=float(spline),
            recv_mono=now,
            sample_id=sample_id,
        )

        kinematics_ok = False
        unusable_reason: Optional[str] = None
        dt = 0.0

        if state.has_baseline and state.last_recv_mono is not None:
            dt = now - state.last_recv_mono
            if dt <= 0:
                unusable_reason = "out_of_order_or_non_positive_dt"
            elif dt < self.config.min_dt_sec:
                unusable_reason = "dt_too_small"
            elif dt > self.config.max_dt_sec:
                unusable_reason = "gap_too_large"
            else:
                kinematics_ok = True
        # else: first sample — establish baseline, no kinematic detectors

        anomalies = run_car_detectors(
            sample,
            state if state.has_baseline else None,
            dt,
            self.config,
            kinematics_ok=kinematics_ok,
        )
        for a in anomalies:
            self.metrics.inc_rule(a.rule_id)

        score, evidence, deduped = apply_anomalies(
            state, sample_id, anomalies, self.config, now, car_id
        )
        if deduped:
            self.metrics.score_deduped += 1

        emitted = self._emit_evidence(evidence)

        # Update baseline only with finite usable kinematics context.
        # Gaps / out-of-order: refresh baseline to current so next Δt is clean,
        # but do not treat the bad interval as evidence.
        self._update_baseline(state, sample, speed_ms_from_vel(sample.vel))

        if unusable_reason is not None:
            self.metrics.inc_unusable(unusable_reason)
            return TickResult(
                disposition=SampleDisposition.UNUSABLE,
                sample_id=sample_id,
                unusable_reason=unusable_reason,
                anomalies=anomalies,  # non-kinematic may still be present
                evidence=emitted,
                risk_score=score,
            )

        self.metrics.samples_ok += 1
        return TickResult(
            disposition=SampleDisposition.OK,
            sample_id=sample_id,
            anomalies=anomalies,
            evidence=emitted,
            risk_score=score,
        )

    # ── LAP_COMPLETED ──────────────────────────────────────────────────

    def on_lap(
        self,
        *,
        server_key: str,
        guid: str,
        car_id: int,
        lap_time_ms: int,
        cuts: int,
        recv_mono: Optional[float] = None,
    ) -> TickResult:
        self.metrics.samples_total += 1
        if not self.config.enabled:
            self.metrics.samples_disabled += 1
            return TickResult(disposition=SampleDisposition.OK, disabled=True)

        if not isinstance(server_key, str) or not server_key:
            self.metrics.samples_invalid += 1
            return TickResult(
                disposition=SampleDisposition.INVALID_PACKET,
                unusable_reason="invalid_server_key",
            )
        if not isinstance(guid, str) or not guid:
            self.metrics.samples_invalid += 1
            return TickResult(
                disposition=SampleDisposition.INVALID_PACKET,
                unusable_reason="invalid_guid",
            )
        try:
            lap_ms = int(lap_time_ms)
            cuts_i = int(cuts)
            car_i = int(car_id)
        except (TypeError, ValueError):
            self.metrics.samples_invalid += 1
            return TickResult(
                disposition=SampleDisposition.INVALID_PACKET,
                unusable_reason="invalid_lap_fields",
            )

        now = float(recv_mono) if recv_mono is not None else self.clock.monotonic()
        sample_id = self.store.allocate_sample_id()
        state = self.store.get_or_create(server_key, guid, car_i)
        sample = LapSample(
            server_key=server_key,
            guid=guid,
            car_id=car_i,
            lap_time_ms=lap_ms,
            cuts=cuts_i,
            recv_mono=now,
            sample_id=sample_id,
        )
        anomalies = run_lap_detectors(sample, self.config)
        for a in anomalies:
            self.metrics.inc_rule(a.rule_id)
        score, evidence, deduped = apply_anomalies(
            state, sample_id, anomalies, self.config, now, car_i
        )
        if deduped:
            self.metrics.score_deduped += 1
        emitted = self._emit_evidence(evidence)
        self.metrics.samples_ok += 1
        return TickResult(
            disposition=SampleDisposition.OK,
            sample_id=sample_id,
            anomalies=anomalies,
            evidence=emitted,
            risk_score=score,
        )

    # ── sanctions hard gate (never auto-kick in this module) ───────────

    def maybe_sanction(self, *_args: Any, **_kwargs: Any) -> None:
        """Explicit no-op. Kick/ban are never invoked from anticheat."""
        return None

    def sanctions_allowed(self) -> bool:
        return self.config.sanctions_allowed()

    # ── internals ──────────────────────────────────────────────────────

    def _update_baseline(self, state, sample: CarSample, speed_ms: float) -> None:
        state.last_recv_mono = sample.recv_mono
        state.last_pos = sample.pos
        state.last_vel = sample.vel
        state.last_speed_ms = speed_ms
        state.last_spline = sample.spline
        state.has_baseline = True
        state.car_id = sample.car_id

    def _emit_evidence(self, evidence: List[EvidenceEvent]) -> List[EvidenceEvent]:
        kept: List[EvidenceEvent] = []
        for ev in evidence:
            if self.sink.enqueue(ev):
                self.metrics.sink_enqueued += 1
                self.metrics.evidence_emitted += 1
                kept.append(ev)
            else:
                self.metrics.sink_dropped += 1
                # Still report in TickResult for callers/tests
                kept.append(ev)
        return kept


def create_engine(
    *,
    config: Optional[AnticheatConfig] = None,
    clock: Optional[MonotonicClock] = None,
    sink: Optional[BoundedEvidenceSink] = None,
    apply_env: bool = True,
    start_sink_worker: Optional[bool] = None,
) -> Tuple[AnticheatEngine, ConfigLoadResult]:
    import logging

    loaded = load_config(apply_env=apply_env) if config is None else None
    if config is None:
        assert loaded is not None
        cfg = loaded.config
        warnings = loaded.warnings
        result = loaded
    else:
        cfg = config
        warnings = []
        result = ConfigLoadResult(config=cfg, warnings=[], source="explicit")
    engine = AnticheatEngine(
        cfg, clock=clock, sink=sink, config_warnings=warnings
    )
    log = logging.getLogger("anticheat")
    for w in warnings:
        log.warning("anticheat config: %s", w)
    if cfg.enabled:
        log.info(
            "anticheat enabled mode=%s sanctions_allowed=%s source=%s",
            cfg.mode,
            cfg.sanctions_allowed(),
            result.source,
        )
    should_start = start_sink_worker if start_sink_worker is not None else cfg.enabled
    if should_start and sink is None:
        engine.sink.start_worker()
    return engine, result


_ENGINE: Optional[AnticheatEngine] = None


def get_engine(*, reset: bool = False) -> AnticheatEngine:
    """Process-wide engine (lazy). Used by handlers when wired."""
    global _ENGINE
    if reset or _ENGINE is None:
        _ENGINE, _ = create_engine(apply_env=True)
    return _ENGINE


def reset_engine_for_tests() -> None:
    global _ENGINE
    if _ENGINE is not None:
        try:
            _ENGINE.sink.stop(drain=True, timeout_sec=0.5)
        except Exception:
            pass
    _ENGINE = None
