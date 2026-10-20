"""Monotonic clock abstraction (injectable for deterministic tests)."""

from __future__ import annotations

import time
from typing import Protocol


class MonotonicClock(Protocol):
    def monotonic(self) -> float:
        """Seconds from an arbitrary fixed origin; only differences matter."""
        ...


class SystemMonotonicClock:
    __slots__ = ()

    def monotonic(self) -> float:
        return time.monotonic()


class FakeClock:
    """Deterministic clock for unit tests."""

    __slots__ = ("_t",)

    def __init__(self, start: float = 0.0) -> None:
        self._t = float(start)

    def monotonic(self) -> float:
        return self._t

    def advance(self, dt: float) -> float:
        self._t += float(dt)
        return self._t

    def set(self, t: float) -> None:
        self._t = float(t)
