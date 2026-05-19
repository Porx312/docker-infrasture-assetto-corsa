import os
import socket
import select
import sys
import threading
import time
import struct
from dotenv import load_dotenv

os.environ["PYTHONUNBUFFERED"] = "1"

# Load .env BEFORE importing modules that read env via core.settings on import.
load_dotenv()

from core import runtime_config, settings  # noqa: E402
from core.config_loader import load_server_configs  # noqa: E402
from core.logging_config import get_logger, setup_logging  # noqa: E402
from core.session_manager import ServerState, send_registration  # noqa: E402
from core.packet_processor import process_packet  # noqa: E402
from network.event_dispatcher import send_server_event  # noqa: E402
from core.redis_config_sync import (  # noqa: E402
    bootstrap_runtime_config_from_stream,
    start_redis_config_consumer,
)

setup_logging()
log = get_logger("main")

SERVER_IP = "127.0.0.1"


def bind_udp_listener(port: int) -> socket.socket:
    """Bind a UDP socket for an AC plugin listen port (raises OSError on conflict)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((SERVER_IP, port))
    sock.setblocking(False)
    return sock


def listen_server(server_state):
    sock = server_state.sock
    if sock is None:
        log.error("[%s] listener skipped (socket not bound)", server_state.port)
        return

    log.info(
        "listener started port=%s server=%s",
        server_state.port,
        server_state.server_name,
    )

    server_state.last_server_addr = (SERVER_IP, server_state.server_cmd_port)
    send_registration(server_state, SERVER_IP)

    while True:
        ready = select.select([sock], [], [], 0.5)
        if ready[0]:
            try:
                data, addr = sock.recvfrom(4096)
                process_packet(data, server_state, addr)
            except ConnectionResetError:
                pass
            except Exception as e:
                log.exception("[%s] packet error: %s", server_state.port, e)


def _build_server_status_signature(players, track, config):
    sorted_players = sorted(
        ({"steamId": p.get("steamId"), "carModel": p.get("carModel")} for p in players),
        key=lambda x: (x.get("steamId") or "", x.get("carModel") or ""),
    )
    return (track or "", config or "", tuple((p["steamId"], p["carModel"]) for p in sorted_players))


def server_status_loop(servers):
    last_signatures: dict[int, tuple] = {}
    last_publish_at: dict[int, float] = {}
    while True:
        time.sleep(max(1, settings.SERVER_STATUS_POLL_INTERVAL_SEC))
        now = time.time()
        for state in servers.values():
            if not state.last_server_addr:
                continue

            for i in range(32):
                packet = struct.pack("BB", 201, i)
                try:
                    state.sock.sendto(packet, state.last_server_addr)
                except Exception:
                    pass
                time.sleep(0.01)

            now_ms = int(time.time() * 1000)
            players = []
            stale_car_ids = []
            for car_id, d in list(state.active_drivers.items()):
                last_seen = getattr(d, "last_seen_ms", 0)
                if last_seen and (now_ms - last_seen) > settings.GHOST_DRIVER_TIMEOUT_MS:
                    stale_car_ids.append(car_id)
                    continue
                if not d.guid.startswith("unknown_"):
                    players.append(
                        {"steamId": d.guid, "name": d.name, "carModel": d.model}
                    )

            server_label = getattr(state, "config_server_name", state.server_name)
            for car_id in stale_car_ids:
                d = state.active_drivers.get(car_id)
                if not d:
                    continue
                if d.guid in state.guid_to_driver:
                    del state.guid_to_driver[d.guid]
                del state.active_drivers[car_id]
                if not d.guid.startswith("unknown_"):
                    send_server_event(
                        "player_leave",
                        server_label,
                        {
                            "steamId": d.guid,
                            "trackName": state.track,
                            "trackConfig": state.config,
                        },
                    )
            if stale_car_ids:
                log.info("[%s] purged %d ghost driver(s)", state.port, len(stale_car_ids))

            signature = _build_server_status_signature(players, state.track, state.config)
            previous_sig = last_signatures.get(state.port)
            previous_publish = last_publish_at.get(state.port, 0.0)
            elapsed = now - previous_publish
            heartbeat_due = elapsed >= settings.SERVER_STATUS_HEARTBEAT_INTERVAL_SEC
            change_due = (
                signature != previous_sig
                and elapsed >= settings.SERVER_STATUS_PUBLISH_INTERVAL_SEC
            )

            if not settings.SERVER_STATUS_ON_CHANGE_ONLY:
                should_publish = True
            else:
                should_publish = previous_sig is None or change_due or heartbeat_due

            if not should_publish:
                continue

            send_server_event(
                "server_status",
                server_label,
                {
                    "players": players,
                    "trackName": state.track,
                    "trackConfig": state.config,
                },
            )
            last_signatures[state.port] = signature
            last_publish_at[state.port] = now


def _bootstrap_modes_from_redis() -> None:
    if not settings.REDIS_CONFIG_CONSUMER_ENABLED or not settings.REDIS_HOST:
        return
    if runtime_config.has_data():
        return
    try:
        from core.redis_client import get_redis_client

        bootstrap_runtime_config_from_stream(get_redis_client())
    except Exception as exc:
        log.warning("cold-start config bootstrap failed: %s", exc)


def main():
    servers = load_server_configs(ServerState)

    if not servers:
        log.error(
            "no server configurations found; set SERVERS_PATH, "
            "TIME_ATTACK_SERVERS_PATH, and/or EVENTS_SERVERS_PATH in .env"
        )
        sys.exit(1)

    _bootstrap_modes_from_redis()
    runtime_config.log_listener_modes(servers)

    bound_servers = []
    bind_failures = []
    for server_state in servers.values():
        try:
            server_state.sock = bind_udp_listener(server_state.port)
            bound_servers.append(server_state)
        except OSError as exc:
            server_state.sock = None
            bind_failures.append((server_state.port, server_state.server_name, exc))

    for port, name, exc in bind_failures:
        log.error("cannot bind UDP %s:%s for %s: %s", SERVER_IP, port, name, exc)

    if not bound_servers:
        log.error(
            "no UDP listeners started — port(s) already in use. "
            "Stop the other telemetry instance: ./stop.sh or pkill -f 'python3 main.py'"
        )
        sys.exit(1)

    if bind_failures:
        log.warning(
            "%d/%d UDP listener(s) failed; continuing with %d server(s)",
            len(bind_failures),
            len(servers),
            len(bound_servers),
        )

    threads = []
    for server_state in bound_servers:
        t = threading.Thread(target=listen_server, args=(server_state,), daemon=True)
        t.start()
        threads.append(t)

    active_servers = {s.port: s for s in bound_servers}
    sync_thread = threading.Thread(target=server_status_loop, args=(active_servers,), daemon=True)
    sync_thread.start()
    threads.append(sync_thread)

    cfg_sync_thread = threading.Thread(
        target=start_redis_config_consumer, args=(active_servers,), daemon=True
    )
    cfg_sync_thread.start()
    threads.append(cfg_sync_thread)

    log.info(
        "%d UDP listener(s) running (%d configured); press Ctrl+C to stop",
        len(bound_servers),
        len(servers),
    )

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("stopping event servers")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        log.exception("fatal error")
        sys.exit(1)
