"""Global registry of active AC server listeners (telemetry-data)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

if TYPE_CHECKING:
    from core.session_manager import DriverInfo, ServerState

_servers: dict[int, ServerState] = {}


def register_server(server_state: ServerState) -> None:
    _servers[server_state.port] = server_state


def all_servers() -> list[ServerState]:
    return list(_servers.values())


def _iter_drivers_for_steam_id(server_state: ServerState, steam_id: str) -> Iterator[DriverInfo]:
    from core.session_manager import DriverInfo

    seen_car_ids: set[int | None] = set()

    driver = server_state.guid_to_driver.get(steam_id)
    if driver is not None:
        seen_car_ids.add(driver.car_id)
        yield driver

    for candidate in server_state.active_drivers.values():
        if candidate.guid != steam_id:
            continue
        if candidate.car_id in seen_car_ids:
            continue
        seen_car_ids.add(candidate.car_id)
        yield candidate

    last_known = getattr(server_state, "last_known_by_car_id", None)
    if not isinstance(last_known, dict):
        return

    for car_id, meta in last_known.items():
        if not isinstance(meta, dict) or meta.get("guid") != steam_id:
            continue
        if car_id in seen_car_ids:
            continue
        seen_car_ids.add(car_id)
        found = DriverInfo(
            meta.get("name") or "Driver",
            steam_id,
            meta.get("model") or "Unknown",
        )
        found.car_id = car_id
        yield found


def find_driver_by_steam_id(steam_id: str) -> list[tuple[ServerState, DriverInfo]]:
    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return []

    matches: list[tuple[ServerState, DriverInfo]] = []
    for server_state in _servers.values():
        for driver in _iter_drivers_for_steam_id(server_state, trimmed):
            matches.append((server_state, driver))
    return matches


def reset_registry_for_tests() -> None:
    _servers.clear()
