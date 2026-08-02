import os
import re

from core.ini_config import (
    extract_config_track,
    extract_server_name,
    extract_track,
    extract_udp_ports,
    read_ini_file,
)
from core.logging_config import get_logger
from core.server_identity import (
    cfg_path_priority,
    derive_server_folder_id,
    is_legacy_root_server_cfg,
)

log = get_logger("config_loader")


def load_server_configs(ServerStateClass):
    """
    Scans the paths in .env for server_cfg.ini files and returns a dictionary
    of {listen_port: ServerStateClass} objects for all found events servers.
    """
    servers = {}

    def get_paths(env_var):
        val = os.getenv(env_var, "").strip('"').strip("'")
        return [p.strip().strip('"').strip("'") for p in val.split(",") if p.strip()]

    def find_all_cfg_paths(base_path):
        """Find all server_cfg.ini files in base_path and its subdirectories."""
        paths = []
        has_numbered = False
        if os.path.isdir(base_path):
            for entry in os.scandir(base_path):
                if entry.is_dir() and re.match(r"server-\d+", entry.name, re.I):
                    cfg_in_sub = os.path.join(entry.path, "cfg", "server_cfg.ini")
                    if os.path.exists(cfg_in_sub):
                        has_numbered = True
                        break

        base_cfg = os.path.join(base_path, "server_cfg.ini")
        if os.path.exists(base_cfg) and not (
            has_numbered and is_legacy_root_server_cfg(base_cfg, base_path)
        ):
            paths.append(base_cfg)

        base_cfg_cfg = os.path.join(base_path, "cfg", "server_cfg.ini")
        if os.path.exists(base_cfg_cfg):
            paths.append(base_cfg_cfg)

        if os.path.isdir(base_path):
            for entry in os.scandir(base_path):
                if entry.is_dir():
                    cfg_in_sub = os.path.join(entry.path, "cfg", "server_cfg.ini")
                    if os.path.exists(cfg_in_sub):
                        paths.append(cfg_in_sub)

        paths.sort(key=cfg_path_priority, reverse=True)
        return paths

    all_paths = get_paths("SERVERS_PATH") + get_paths("TIME_ATTACK_SERVERS_PATH") + get_paths(
        "EVENTS_SERVERS_PATH"
    )

    for base_path in all_paths:
        cfg_paths = find_all_cfg_paths(base_path)
        if not cfg_paths:
            log.warning("no server_cfg.ini found in: %s", base_path)
            continue

        for cfg_path in cfg_paths:
            try:
                content = read_ini_file(cfg_path)
                if content is None:
                    log.warning("could not read %s", cfg_path)
                    continue

                listen_port, cmd_port = extract_udp_ports(content)
                if listen_port is None or cmd_port is None:
                    log.warning("missing UDP ports in %s", cfg_path)
                    continue

                name = extract_server_name(content) or "Events Server"
                track = extract_track(content) or "Unknown"
                config_track = extract_config_track(content) or ""
                folder_id = derive_server_folder_id(cfg_path)

                if listen_port in servers:
                    existing = servers[listen_port]
                    if cfg_path_priority(cfg_path) <= cfg_path_priority(existing.cfg_path or ""):
                        log.warning(
                            "duplicate listen port %s ignored: %s (keeping %s folder=%s)",
                            listen_port,
                            cfg_path,
                            existing.cfg_path,
                            existing.server_folder_id,
                        )
                        continue
                    log.warning(
                        "duplicate listen port %s replacing %s with %s (folder=%s)",
                        listen_port,
                        existing.cfg_path,
                        cfg_path,
                        folder_id,
                    )

                state = ServerStateClass(
                    listen_port, cmd_port, track, config_track, name, cfg_path=cfg_path
                )
                state.server_folder_id = folder_id
                servers[listen_port] = state
                log.info(
                    "events server folder=%s display=%s | %s (%s) | listen:%s | %s",
                    folder_id or "?",
                    name,
                    track,
                    config_track,
                    listen_port,
                    cfg_path,
                )

            except Exception as e:
                log.error("error reading %s: %s", cfg_path, e)

    return servers
