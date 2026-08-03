#!/usr/bin/env bash
# Install Caddy on the host (systemd) OR start via Docker if sudo unavailable.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if sudo -n true 2>/dev/null; then
  exec "$ROOT_DIR/scripts/setup-caddy-systemd.sh"
fi

echo "No passwordless sudo — using Docker Caddy instead."
exec "$ROOT_DIR/scripts/start-caddy-docker.sh"
