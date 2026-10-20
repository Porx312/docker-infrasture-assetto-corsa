"""Bounded per-(server_key, guid) session state."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional, Tuple

from anticheat.types import Vec3


PlayerKey = Tuple[str, str]  # (server_key, guid)


@dataclass
class PlayerState:
    server_key: str
    guid: str
    car_id: int = -1
    risk_score: float = 0.0
    last_recv_mono: Optional[float] = None
    last_pos: Optional[Vec3] = None
    last_vel: Optional[Vec3] = None
    last_speed_ms: Optional[float] = None
    last_spline: Optional[float] = None
    last_scored_sample_id: Optional[int] = None
    recent_sample_ids: Deque[int] = field(default_factory=lambda: deque(maxlen=8))
    has_baseline: bool = False

    def clear_kinematics(self) -> None:
        self.last_recv_mono = None
        self.last_pos = None
        self.last_vel = None
        self.last_speed_ms = None
        self.last_spline = None
        self.has_baseline = False


class StateStore:
    """Session store keyed by (server_key, guid). Disconnect removes all state."""

    def __init__(self, ring_buffer_size: int = 8) -> None:
        self._ring = max(1, int(ring_buffer_size))
        self._players: Dict[PlayerKey, PlayerState] = {}
        self._next_sample_id: int = 1

    def _key(self, server_key: str, guid: str) -> PlayerKey:
        return (server_key, guid)

    def get(self, server_key: str, guid: str) -> Optional[PlayerState]:
        return self._players.get(self._key(server_key, guid))

    def get_or_create(self, server_key: str, guid: str, car_id: int) -> PlayerState:
        key = self._key(server_key, guid)
        state = self._players.get(key)
        if state is None:
            state = PlayerState(
                server_key=server_key,
                guid=guid,
                car_id=car_id,
                recent_sample_ids=deque(maxlen=self._ring),
            )
            self._players[key] = state
        else:
            state.car_id = car_id
        return state

    def allocate_sample_id(self) -> int:
        sid = self._next_sample_id
        self._next_sample_id += 1
        return sid

    def remove(self, server_key: str, guid: str) -> bool:
        return self._players.pop(self._key(server_key, guid), None) is not None

    def player_count(self) -> int:
        return len(self._players)

    def clear_all(self) -> None:
        self._players.clear()
