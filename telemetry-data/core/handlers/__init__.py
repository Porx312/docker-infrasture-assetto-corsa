"""Thin ACSP packet dispatch — one handler module per packet type."""

from __future__ import annotations

from network.ac_packet import ACSP

from core.handlers import (
    car_info,
    car_update,
    client_event,
    client_loaded,
    connection_closed,
    lap_completed,
    new_connection,
    new_session,
)
from core.handlers.common import ensure_last_known_cache
from core.logging_config import get_logger
from core.session_manager import send_registration

log = get_logger("packet_processor")

_HANDLERS = {
    ACSP.NEW_SESSION: new_session.handle_new_session,
    ACSP.NEW_CONNECTION: new_connection.handle_new_connection,
    ACSP.CLIENT_LOADED: client_loaded.handle_client_loaded,
    ACSP.CAR_INFO: car_info.handle_car_info,
    ACSP.CONNECTION_CLOSED: connection_closed.handle_connection_closed,
    getattr(ACSP, "CAR_UPDATE", 53): car_update.handle_car_update,
    getattr(ACSP, "CLIENT_EVENT", 130): client_event.handle_client_event,
    ACSP.LAP_COMPLETED: lap_completed.handle_lap_completed,
}


def dispatch_packet(packet_type: int, parser, server_state, addr) -> None:
    handler = _HANDLERS.get(packet_type)
    if handler is None:
        return
    handler(parser, server_state, addr)


def process_packet(data, server_state, addr):
    server_ip = addr[0]
    if server_state.last_server_addr is None:
        log.info("auto-connected server=%s @ %s", server_state.server_name, server_ip)
        server_state.last_server_addr = (server_ip, server_state.server_cmd_port)
        send_registration(server_state, server_ip)

    server_state.last_server_addr = addr
    from network.ac_packet import PacketParser

    parser = PacketParser(data)
    packet_type = parser.read_uint8()
    if packet_type is None:
        return

    ensure_last_known_cache(server_state)
    dispatch_packet(packet_type, parser, server_state, addr)
