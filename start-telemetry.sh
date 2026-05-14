#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/telemetry-data"

if ! python3 -c "import dotenv" 2>/dev/null && ! python3 -c "from dotenv import load_dotenv" 2>/dev/null; then
    echo "Installing Python dependencies..."
    python3 -m pip install --break-system-packages -r requirements.txt --quiet
fi

# Load environment and start
source ../.env.local

echo "Starting telemetry-data on host..."
python3 main.py