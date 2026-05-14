#!/bin/bash
# CloneServer.sh - Clone a server template and configure unique ports
# Usage: ./CloneServer.sh <new_server_name> <base_udp_port> <base_http_port>

set -e

TEMPLATE_DIR="$(dirname "$0")/server-template"
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

PLUGIN_ADDRESS_PORT=$((BASE_UDP_PORT + 2000))
PLUGIN_LOCAL_PORT=$((BASE_UDP_PORT + 2001))

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

echo "✅ Server $NEW_SERVER_NAME created successfully!"
echo "   UDP Port: $BASE_UDP_PORT"
echo "   HTTP Port: $BASE_HTTP_PORT"
echo "   Plugin Address: 127.0.0.1:$PLUGIN_ADDRESS_PORT"
echo "   Plugin Local: $PLUGIN_LOCAL_PORT"
echo ""
echo "Next steps:"
echo "  1. Add server config in Convex dashboard"
echo "  2. Start server via: cd $ASSETTO_ROOT/$NEW_SERVER_NAME && ./acServer -c cfg/server_cfg.ini"