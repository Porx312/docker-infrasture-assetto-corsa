#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/telemetry-data"

if ! python3 -c "import dotenv" 2>/dev/null && ! python3 -c "from dotenv import load_dotenv" 2>/dev/null; then
    echo "Installing Python dependencies..."
    python3 -m pip install --break-system-packages -r requirements.txt --quiet
fi

# Load environment (ASSETTO_ENV_FILE set by start.sh, or default dev)
ENV_FILE="${ASSETTO_ENV_FILE:-$SCRIPT_DIR/.env.local}"
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: env file not found: $ENV_FILE"
    echo "Run from repo root: ./start.sh dev   or set ASSETTO_ENV_FILE"
    exit 1
fi
export ASSETTO_ENV_FILE="$ENV_FILE"
export ASSETTO_ENV="${ASSETTO_ENV:-dev}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "Starting telemetry-data on host (env: $ENV_FILE)..."
python3 main.py