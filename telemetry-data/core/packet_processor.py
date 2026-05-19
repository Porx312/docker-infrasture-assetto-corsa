import os
import time
import re
from network.ac_packet import ACSP, PacketParser
from core.session_manager import DriverInfo, send_registration, send_chat, send_admin_command
from core import runtime_config, settings
from core.logging_config import get_logger
from network.event_dispatcher import send_server_event

log = get_logger("packet_processor")


def _mark_driver_seen(driver):
    driver.last_seen_ms = int(time.time() * 1000)


def _resolve_server_mode(server_state):
    mode = runtime_config.get_mode_for_state(server_state)
    if mode is not None or getattr(server_state, "_mode_lookup_logged", False):
        return mode
    server_state._mode_lookup_logged = True
    if not runtime_config.has_data():
        log.warning(
            "[%s] runtime_config empty — no battle/time-attack until ac:config snapshot "
            "(is ac-data running and REDIS_CONFIG_CONSUMER_ENABLED=true?)",
            server_state.port,
        )
    else:
        log.warning(
            "[%s] no mode for folder=%r ini_name=%r ac_name=%r; convex modes=%s",
            server_state.port,
            getattr(server_state, "server_folder_id", ""),
            getattr(server_state, "config_server_name", ""),
            getattr(server_state, "server_name", ""),
            runtime_config.snapshot(),
        )
    return mode


def _drop_stale_drivers_on_new_session(server_state, now_ms):
    """
    Tras reinicios/rotaciones del server pueden quedar drivers "fantasma" en memoria
    si no llegó CONNECTION_CLOSED. Solo quita entradas con last_seen antiguo (no borrar
    a todos los que last_seen==0: eso vaciaba el lobby y rompía batallas).
    """
    removed = 0
    for car_id, driver in list(server_state.active_drivers.items()):
        last_seen = getattr(driver, "last_seen_ms", 0)
        if last_seen <= 0:
            continue
        if (now_ms - last_seen) <= settings.GHOST_DRIVER_TIMEOUT_MS:
            continue
        if driver.guid in server_state.guid_to_driver:
            del server_state.guid_to_driver[driver.guid]
        server_state.battle_manager.remove_car(driver.guid)
        del server_state.active_drivers[car_id]
        removed += 1
    if removed:
        log.info("[%s] NEW_SESSION cleanup removed %d ghost(s)", server_state.port, removed)


def process_packet(data, server_state, addr):
    # Auto-connect logic: register once per server startup/connection when we see traffic
    server_ip = addr[0]
    if server_state.last_server_addr is None:
        log.info("auto-connected server=%s @ %s", server_state.server_name, server_ip)
        server_state.last_server_addr = (server_ip, server_state.server_cmd_port)
        send_registration(server_state, server_ip)

    server_state.last_server_addr = addr
    parser = PacketParser(data)
    packet_type = parser.read_uint8()
    if packet_type is None:
        return
    # Keep a lightweight cache to recover driver identity by car slot when packets arrive out of order.
    if not hasattr(server_state, "last_known_by_car_id"):
        server_state.last_known_by_car_id = {}

    # ─── NEW_SESSION (50) ───────────────────────────────────
    if packet_type == ACSP.NEW_SESSION:
        now_ms = int(time.time() * 1000)
        _drop_stale_drivers_on_new_session(server_state, now_ms)
        # After AC /restart_session, some servers stop realtime feed subscriptions.
        # Re-register to ensure packet 53 (CAR_UPDATE) resumes.
        last_reg_ms = getattr(server_state, "last_registration_ms", 0)
        if now_ms - last_reg_ms >= settings.REGISTRATION_REFRESH_MIN_MS:
            send_registration(server_state, addr[0])
            server_state.last_registration_ms = now_ms

        parser.read_uint8()   # version
        parser.read_uint8()   # sessionIndex
        parser.read_uint8()   # currentSessionIndex
        parser.read_uint8()   # sessionCount

        # NEW_SESSION is a mixed bag: 
        # - Server Name is typically a wstring (UTF-32)
        # - Track and Config are typically standard strings (1 byte length)
        server_state.server_name = parser.read_wstring()
        server_state.track       = parser.read_string()
        server_state.config      = parser.read_string()

        # If we have a cfg_path, reload it to update config_server_name and ensure track info
        if server_state.cfg_path and os.path.exists(server_state.cfg_path):
            try:
                with open(server_state.cfg_path, 'rb') as f:
                    raw = f.read()
                try:
                    content = raw.decode('utf-8')
                except UnicodeDecodeError:
                    content = raw.decode('utf-16le', errors='ignore')

                # Update server names
                server_name_m = re.search(r'^SERVER_NAME=(.+)', content, re.MULTILINE)
                if not server_name_m:
                    server_name_m = re.search(r'^NAME=(.+)', content, re.MULTILINE)
                if server_name_m:
                    server_state.config_server_name = server_name_m.group(1).strip()

                # Robustly update track/config from INI if packet data looks weird or we want disk priority
                track_m  = re.search(r'^TRACK=(.+)', content, re.MULTILINE)
                config_m = re.search(r'^CONFIG_TRACK=(.*)', content, re.MULTILINE)
                if track_m:
                    server_state.track = track_m.group(1).strip()
                if config_m:
                    server_state.config = config_m.group(1).strip()
                
                log.info("[%s] config reloaded from %s", server_state.port, server_state.cfg_path)
            except Exception as e:
                log.error("[%s] error reloading %s: %s", server_state.port, server_state.cfg_path, e)

        server_mode = _resolve_server_mode(server_state)
        is_battle_server = server_mode == "battle"
        server_state.battle_manager.set_server_mode(is_battle_server)

        if server_mode:
            event_info = f" | 🎛️  Mode: {server_mode}"
        else:
            event_info = " | ⚠️  Mode unknown (waiting Redis snapshot)"

        log.info(
            "[%s] session track=%s config=%s name=%s%s",
            server_state.port,
            server_state.track,
            server_state.config,
            server_state.server_name,
            event_info,
        )

    # ─── NEW_CONNECTION (51) ────────────────────────────────
    elif packet_type == ACSP.NEW_CONNECTION:
        name   = parser.read_wstring()
        guid   = parser.read_wstring()
        car_id = parser.read_uint8()
        if car_id is None: return
        model  = parser.read_string()
        _skin  = parser.read_string()

        if not name or not guid: return

        driver = DriverInfo(name, guid, model)
        _mark_driver_seen(driver)
        driver.car_id = car_id
        server_state.active_drivers[car_id] = driver
        if guid and not guid.startswith('unknown_'):
            server_state.guid_to_driver[guid] = driver
            server_state.last_known_by_car_id[car_id] = {
                "guid": guid,
                "name": name,
                "model": model,
                "seen_ms": int(time.time() * 1000),
            }

        log.info("[%s] connected car=%s name=%s model=%s guid=%s", server_state.port, car_id, name, model, guid)
        server_state.battle_manager.set_driver_name(guid, name)

        driver.lap_start_time = time.time() * 1000
        driver.lap_notified_fail = False

        # Notify Node.js the player joined (Event webhook dropped as it's not a lap update)
        if not guid.startswith('unknown_'):
            
            # Node.js General Webhook
            send_server_event(
                "player_join",
                getattr(server_state, "config_server_name", server_state.server_name),
                {
                    "steamId": guid,
                    "name": name,
                    "carModel": model,
                    "trackName": server_state.track,
                    "trackConfig": server_state.config,
                },
            )

    # ─── CAR_INFO (210) ─────────────────────────────────────
    elif packet_type == ACSP.CAR_INFO:
        car_id       = parser.read_uint8()
        if car_id is None: return
        is_connected = parser.read_uint8()
        model   = parser.read_wstring()
        _skin   = parser.read_wstring()
        name    = parser.read_wstring()
        _team   = parser.read_wstring()
        guid    = parser.read_wstring()

        # If AC says this slot is empty OR the player aborted load (connected but no name/guid),
        # but we still have them tracked as an active driver...
        if is_connected == 0 or not name or not guid:
            driver = server_state.active_drivers.get(car_id)
            if driver:
                # Debounce transient empty CAR_INFO pulses to avoid flapping remove/re-add.
                suspects = getattr(server_state, "ghost_suspects", None)
                if suspects is None:
                    suspects = {}
                    server_state.ghost_suspects = suspects
                first_seen = suspects.get(car_id, 0)
                now_ms = int(time.time() * 1000)
                if not first_seen:
                    suspects[car_id] = now_ms
                    return
                if now_ms - first_seen < settings.GHOST_CARINFO_DEBOUNCE_MS:
                    return
                suspects.pop(car_id, None)

                # Only purge if the driver is truly stale.
                # Empty CAR_INFO pulses can happen transiently while the player is still online.
                last_seen = getattr(driver, "last_seen_ms", 0)
                if last_seen > 0 and (now_ms - last_seen) <= settings.GHOST_DRIVER_TIMEOUT_MS:
                    return

                log.info("[%s] ghost cleanup car=%s name=%s", server_state.port, car_id, driver.name)
                
                # Node.js Event Leave
                if not driver.guid.startswith('unknown_'):
                    send_server_event("player_leave", getattr(server_state, 'config_server_name', server_state.server_name), {
                        "steamId": driver.guid,
                        "trackName": server_state.track,
                        "trackConfig": server_state.config
                    })

                server_state.battle_manager.remove_car(driver.guid)
                if driver.guid in server_state.guid_to_driver:
                    del server_state.guid_to_driver[driver.guid]
                del server_state.active_drivers[car_id]
            return

        if not name or not guid: return
        suspects = getattr(server_state, "ghost_suspects", None)
        if suspects is not None:
            suspects.pop(car_id, None)

        # DO NOT wipe existing driver state (laps, penalties) on heartbeat ping
        driver = server_state.active_drivers.get(car_id)
        if not driver:
            driver = DriverInfo(name, guid, model)
            _mark_driver_seen(driver)
            server_state.active_drivers[car_id] = driver
        else:
            driver.name = name
            driver.guid = guid
            driver.model = model
            _mark_driver_seen(driver)
            
        if guid and not guid.startswith('unknown_'):
            server_state.guid_to_driver[guid] = driver
            server_state.last_known_by_car_id[car_id] = {
                "guid": guid,
                "name": name,
                "model": model,
                "seen_ms": int(time.time() * 1000),
            }

        log.debug("[%s] car_info car=%s name=%s model=%s", server_state.port, car_id, name, model)
        server_state.battle_manager.set_driver_name(guid, name)

        # If realtime stream (packet 53) drops, recover subscription proactively.
        now_ms = int(time.time() * 1000)
        last_car_update_ms = getattr(server_state, "last_car_update_ms", 0)
        last_reg_ms = getattr(server_state, "last_registration_ms", 0)
        if (
            now_ms - last_car_update_ms >= settings.CAR_UPDATE_WATCHDOG_MS
            and now_ms - last_reg_ms >= settings.REGISTRATION_REFRESH_MIN_MS
        ):
            send_registration(server_state, addr[0])
            server_state.last_registration_ms = now_ms
            log.info("[%s] re-subscribed realtime feed (no CAR_UPDATE)", server_state.port)

    # ─── CONNECTION_CLOSED (52) ─────────────────────────────
    elif packet_type == ACSP.CONNECTION_CLOSED:
        name   = parser.read_wstring()
        guid   = parser.read_wstring()
        car_id = parser.read_uint8()
        if car_id is None: return

        driver = server_state.active_drivers.get(car_id)
        if driver:
            log.info("[%s] disconnected car=%s name=%s", server_state.port, car_id, driver.name)
            if not driver.guid.startswith('unknown_'):
                send_server_event(
                    "player_leave",
                    getattr(server_state, "config_server_name", server_state.server_name),
                    {
                        "steamId": driver.guid,
                        "trackName": server_state.track,
                        "trackConfig": server_state.config,
                    },
                )

                server_state.battle_manager.remove_car(driver.guid)
            if driver.guid in server_state.guid_to_driver:
                del server_state.guid_to_driver[driver.guid]
            del server_state.active_drivers[car_id]

    # ─── CAR_UPDATE (53) ────────────────────────────────────
    elif packet_type == getattr(ACSP, 'CAR_UPDATE', 53):
        car_id = parser.read_uint8()
        if car_id is None: return
        pos_x  = parser.read_float()
        pos_y  = parser.read_float()
        pos_z  = parser.read_float()
        v_x    = parser.read_float()
        v_y    = parser.read_float()
        v_z    = parser.read_float()
        gear   = parser.read_uint8()
        rpm    = parser.read_uint16()
        spline = parser.read_float()
        
        driver = server_state.active_drivers.get(car_id)
        if driver:
            _mark_driver_seen(driver)
            server_state.last_car_update_ms = int(time.time() * 1000)
            speed_ms = ((v_x or 0)**2 + (v_y or 0)**2 + (v_z or 0)**2)**0.5
            now = int(time.time() * 1000)
            
            server_mode = _resolve_server_mode(server_state)
            meta = runtime_config.get_event_constraints_for_state(server_state)

            driver.car_id = car_id
            server_state.event_engine.check_idle(driver, speed_ms, now, meta)

            is_battle_server = server_mode == "battle"
            server_state.battle_manager.set_server_mode(is_battle_server)

            # Feed BattleManager only on battle servers.
            if is_battle_server:
                server_state.battle_manager.update(
                    driver.guid, spline, speed_ms * 3.6, (pos_x, pos_y, pos_z)
                )

    # ─── CLIENT_EVENT (130) ─────────────────────────────────
    elif packet_type == getattr(ACSP, 'CLIENT_EVENT', 130):
        ev_type = parser.read_uint8()
        car_id  = parser.read_uint8()
        
        # Battle Engine Collision Check
        if ev_type == getattr(ACSP, 'CE_COLLISION_WITH_CAR', 10):
            other_car_id = parser.read_uint8()
            impact_speed = parser.read_float()
            driver1 = server_state.active_drivers.get(car_id)
            driver2 = server_state.active_drivers.get(other_car_id)
            server_mode = _resolve_server_mode(server_state)
            is_battle_server = server_mode == "battle"
            server_state.battle_manager.set_server_mode(is_battle_server)
            if is_battle_server and driver1 and driver2:
                server_state.battle_manager.handle_collision(
                    driver1.guid, driver2.guid, impact_speed
                )
        elif ev_type == getattr(ACSP, 'CE_COLLISION_WITH_ENV', 11):
            pass
        
        if ev_type in (getattr(ACSP, 'CE_COLLISION_WITH_CAR', 10), getattr(ACSP, 'CE_COLLISION_WITH_ENV', 11)):
            driver = server_state.active_drivers.get(car_id)
            if driver:
                driver.car_id = car_id
                server_mode = _resolve_server_mode(server_state)
                if server_mode in ("event", "time-attack"):
                    meta = runtime_config.get_event_constraints_for_state(server_state)
                    server_state.event_engine.check_collision(driver, meta)

    # ─── LAP_COMPLETED (58) ─────────────────────────────────
    elif packet_type == ACSP.LAP_COMPLETED:
        car_id      = parser.read_uint8()
        if car_id is None: return
        ac_lap_time = parser.read_uint32() or 0
        cuts        = parser.read_uint8() or 0

        now    = int(time.time() * 1000)
        driver = server_state.active_drivers.get(car_id)

        if not driver:
            # Recover from recent CAR_INFO/NEW_CONNECTION cache to avoid losing laps.
            cached = server_state.last_known_by_car_id.get(car_id)
            if cached and cached.get("guid"):
                driver = DriverInfo(
                    cached.get("name") or f"Driver_CarID_{car_id}",
                    cached["guid"],
                    cached.get("model") or "Unknown",
                )
                driver.car_id = car_id
                _mark_driver_seen(driver)
                server_state.active_drivers[car_id] = driver
                if not driver.guid.startswith('unknown_'):
                    server_state.guid_to_driver[driver.guid] = driver
            else:
                import struct
                # Ask AC for fresh CAR_INFO and skip this lap if identity is unknown.
                if server_state.last_server_addr:
                    server_state.sock.sendto(struct.pack('BB', 201, car_id), server_state.last_server_addr)
                log.warning("[%s] LAP_COMPLETED unknown car=%s, waiting CAR_INFO", server_state.port, car_id)
                return
        else:
            _mark_driver_seen(driver)

        if ac_lap_time <= 0 or ac_lap_time > 36000000:
            return

        if ac_lap_time < settings.MIN_VALID_LAP_MS:
            log.warning(
                "[%s] lap ignored suspicious time %.3fs < %.3fs",
                server_state.port,
                ac_lap_time / 1000,
                settings.MIN_VALID_LAP_MS / 1000,
            )
            return

        driver.last_lap   = ac_lap_time
        driver.lap_count += 1
        is_valid = (cuts == 0)

        meta = runtime_config.get_event_constraints_for_state(server_state)

        driver.car_id = car_id
        is_valid, fail_reason = server_state.event_engine.evaluate_lap(driver, ac_lap_time, cuts, meta)

        if not is_valid:
            log.info("[%s] lap invalid name=%s time=%.3fs cuts=%s (%s)", server_state.port, driver.name, ac_lap_time / 1000, cuts, fail_reason)
            return

        if driver.best_lap == 0 or ac_lap_time < driver.best_lap:
            driver.best_lap = ac_lap_time

        log.info(
            "[%s] lap valid name=%s #%s time=%.3fs best=%.3fs",
            server_state.port,
            driver.name,
            driver.lap_count,
            ac_lap_time / 1000,
            driver.best_lap / 1000,
        )

        if not driver.guid.startswith('unknown_'):
            send_server_event(
                "lap_completed",
                getattr(server_state, "config_server_name", server_state.server_name),
                {
                    "steamId": driver.guid,
                    "carModel": driver.model,
                    "trackName": server_state.track,
                    "trackConfig": server_state.config,
                    "lapTime": ac_lap_time,
                },
            )
