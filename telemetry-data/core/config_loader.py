import os
import re

def load_server_configs(ServerStateClass):
    """
    Scans the paths in .env for server_cfg.ini files and returns a dictionary
    of {listen_port: ServerStateClass} objects for all found events servers.
    """
    servers = {}

    def get_paths(env_var):
        val = os.getenv(env_var, '').strip('"').strip("'")
        return [p.strip().strip('"').strip("'") for p in val.split(',') if p.strip()]

    def find_all_cfg_paths(base_path):
        """Find all server_cfg.ini files in base_path and its subdirectories."""
        paths = []
        base_cfg = os.path.join(base_path, 'server_cfg.ini')
        if os.path.exists(base_cfg):
            paths.append(base_cfg)
        base_cfg_cfg = os.path.join(base_path, 'cfg', 'server_cfg.ini')
        if os.path.exists(base_cfg_cfg):
            paths.append(base_cfg_cfg)
        if os.path.isdir(base_path):
            for entry in os.scandir(base_path):
                if entry.is_dir():
                    cfg_in_sub = os.path.join(entry.path, 'cfg', 'server_cfg.ini')
                    if os.path.exists(cfg_in_sub):
                        paths.append(cfg_in_sub)
        return paths

    all_paths = get_paths('SERVERS_PATH') + get_paths('TIME_ATTACK_SERVERS_PATH') + get_paths('EVENTS_SERVERS_PATH')

    for base_path in all_paths:
        cfg_paths = find_all_cfg_paths(base_path)
        if not cfg_paths:
            print(f"⚠️  No server_cfg.ini found in: {base_path}")
            continue

        for cfg_path in cfg_paths:
            try:
                with open(cfg_path, 'rb') as f:
                    raw = f.read()

                try:
                    content = raw.decode('utf-8')
                except UnicodeDecodeError:
                    content = raw.decode('utf-16le', errors='ignore')

                plugin_port_m  = re.search(r'^UDP_PLUGIN_LOCAL_PORT=(\d+)', content, re.MULTILINE)
                udp_addr_m     = re.search(r'^UDP_PLUGIN_ADDRESS=(?:[^:]+:)?(\d+)', content, re.MULTILINE)

                if not plugin_port_m or not udp_addr_m:
                    print(f"⚠️  Missing UDP ports in {cfg_path}")
                    continue

                server_name_m  = re.search(r'^SERVER_NAME=(.+)', content, re.MULTILINE)
                if not server_name_m:
                    server_name_m  = re.search(r'^NAME=(.+)', content, re.MULTILINE)

                track_m        = re.search(r'^TRACK=(.+)', content, re.MULTILINE)
                config_m       = re.search(r'^CONFIG_TRACK=(.*)', content, re.MULTILINE)

                cmd_port    = int(plugin_port_m.group(1).strip())
                listen_port = int(udp_addr_m.group(1).strip())

                name = "Events Server"
                if server_name_m:
                    name = server_name_m.group(1).strip()

                track       = track_m.group(1).strip()       if track_m       else "Unknown"
                config_track = config_m.group(1).strip()      if config_m      else ""

                if listen_port not in servers:
                    servers[listen_port] = ServerStateClass(listen_port, cmd_port, track, config_track, name, cfg_path=cfg_path)
                    print(f"📋 Events server: {name} | {track} ({config_track}) | Listen:{listen_port}")

            except Exception as e:
                print(f"❌ Error reading {cfg_path}: {e}")

    return servers