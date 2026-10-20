"""Fixtures for anticheat unit tests (no sockets / Redis)."""

from __future__ import annotations

import os
import sys

import pytest

# Allow `from helpers import drive` when pytest collects this directory.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from anticheat.clock import FakeClock
from anticheat.config import AnticheatConfig
from anticheat.engine import AnticheatEngine
from anticheat.sink import CollectingSink


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(0.0)


@pytest.fixture
def enabled_config() -> AnticheatConfig:
    return AnticheatConfig(
        enabled=True,
        mode="observe",
        sanctions_enabled=False,
        max_speed_kmh=450.0,
        min_dt_sec=0.001,
        max_dt_sec=0.5,
        position_jump_margin_m=15.0,
        position_jump_speed_factor=2.5,
        max_accel_ms2=80.0,
        evidence_score_threshold=12.0,
        score_weight_low=1.0,
        score_weight_medium=3.0,
        score_weight_high=8.0,
        sink_queue_size=8,
    )


@pytest.fixture
def engine(enabled_config, clock) -> AnticheatEngine:
    sink = CollectingSink(maxsize=enabled_config.sink_queue_size)
    return AnticheatEngine(enabled_config, clock=clock, sink=sink)
