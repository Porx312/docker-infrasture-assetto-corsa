#!/bin/bash
# CloneServer.sh - Clone a server template and configure unique ports
# Usage: ./CloneServer.sh <new_server_name> <base_udp_port> <base_http_port>

set -e

TEMPLATE_DIR="$(dirname "$0")/server-template"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETTO_ROOT="${ASSETTO_ROOT:-/home/jose/assetto-infra/server}"
NEW_SERVER_NAME="$1"
BASE_UDP_PORT="$2"
BASE_HTTP_PORT="$3"

if [ -z "$NEW_SERVER_NAME" ] || [ -z "$BASE_UDP_PORT" ] || [ -z "$BASE_HTTP_PORT" ]; then
    echo "Usage: ./CloneServer.sh <server_name> <base_udp_port> <base_http_port>"
    echo "Example: ./CloneServer.sh server-12 9720 8093"
    exit 1
fi

TARGET_DIR="$ASSETTO_ROOT/$NEW_SERVER_NAME"

if [ -d "$TARGET_DIR" ]; then
    echo "Error: Server $NEW_SERVER_NAME already exists at $TARGET_DIR"
    exit 1
fi

echo "Cloning server template to $TARGET_DIR..."
mkdir -p "$TARGET_DIR/cfg"

cp "$TEMPLATE_DIR/cfg/server_cfg.ini" "$TARGET_DIR/cfg/server_cfg.ini"
cp "$TEMPLATE_DIR/cfg/entry_list.ini" "$TARGET_DIR/cfg/entry_list.ini"

# server-N: address = 12000 + offset, local = 12001 + offset
# N=1,2 → offset = N*10; N>=3 → offset = (N+1)*10 (legacy gap at server-3)
N=$(( (BASE_UDP_PORT - 9600) / 10 ))
if [ "$N" -le 2 ]; then
    OFFSET=$(( N * 10 ))
else
    OFFSET=$(( (N + 1) * 10 ))
fi
PLUGIN_ADDRESS_PORT=$(( 12000 + OFFSET ))
PLUGIN_LOCAL_PORT=$(( 12001 + OFFSET ))

echo "Configuring ports: UDP=$BASE_UDP_PORT HTTP=$BASE_HTTP_PORT PluginAddr=$PLUGIN_ADDRESS_PORT PluginLocal=$PLUGIN_LOCAL_PORT"

sed -i "s/CHANGE_ME_SERVER_NAME/$NEW_SERVER_NAME/g" "$TARGET_DIR/cfg/server_cfg.ini"
sed -i "s/CHANGE_ME_UDP_PORT/$BASE_UDP_PORT/g" "$TARGET_DIR/cfg/server_cfg.ini"
sed -i "s/CHANGE_ME_HTTP_PORT/$BASE_HTTP_PORT/g" "$TARGET_DIR/cfg/server_cfg.ini"
sed -i "s/CHANGE_ME_PLUGIN_ADDRESS_PORT/$PLUGIN_ADDRESS_PORT/g" "$TARGET_DIR/cfg/server_cfg.ini"
sed -i "s/CHANGE_ME_PLUGIN_LOCAL_PORT/$PLUGIN_LOCAL_PORT/g" "$TARGET_DIR/cfg/server_cfg.ini"

ln -sf "$ASSETTO_ROOT/content" "$TARGET_DIR/content"
ln -sf "$ASSETTO_ROOT/system" "$TARGET_DIR/system"
ln -sf "$ASSETTO_ROOT/blacklist.txt" "$TARGET_DIR/blacklist.txt"
ln -sf "$ASSETTO_ROOT/acServer" "$TARGET_DIR/acServer"
mkdir -p "$TARGET_DIR/logs" "$TARGET_DIR/results" "$TARGET_DIR/setups"

# CM wrapper params (port = HTTP + 10000) and branding from shared config
if [ -f "$ROOT_DIR/server/shared/server-branding.json" ]; then
  BRANDING_FILE="$ROOT_DIR/server/shared/server-branding.json" \
    "$ROOT_DIR/scripts/generate-cm-wrapper-params.sh" 2>/dev/null || true
  "$ROOT_DIR/scripts/set-server-description.sh" 2>/dev/null || true
  apply_one() {
    python3 - "$TARGET_DIR/cfg/server_cfg.ini" "$TARGET_DIR/cfg/cm_wrapper_params.json" <<'PY'
import json, re, sys
ini_path, params_path = sys.argv[1], sys.argv[2]
if not __import__("os").path.isfile(params_path):
    sys.exit(0)
port = json.load(open(params_path))["port"]
sep = "\u2139"
content = open(ini_path, encoding="utf-8").read()
m = re.search(r"^NAME=(.*)$", content, re.M)
if not m:
    sys.exit(0)
name = m.group(1).strip()
base = name[: name.index(sep)].rstrip() if sep in name else name
new_name = f"{base} {sep}{port}"
open(ini_path, "w", encoding="utf-8", newline="\n").write(
    re.sub(r"^NAME=.*$", f"NAME={new_name}", content, count=1, flags=re.M)
)
PY
  }
  apply_one
fi

echo "✅ Server $NEW_SERVER_NAME created successfully!"
echo "   UDP Port: $BASE_UDP_PORT"
echo "   HTTP Port: $BASE_HTTP_PORT"
echo "   Plugin Address: 127.0.0.1:$PLUGIN_ADDRESS_PORT"
echo "   Plugin Local: $PLUGIN_LOCAL_PORT"
echo ""
echo "Next steps:"
echo "  1. Add server config in Convex dashboard"
echo "  2. Start server via: cd $ASSETTO_ROOT/$NEW_SERVER_NAME && ./acServer -c cfg/server_cfg.ini"