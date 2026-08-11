#!/usr/bin/env bash
# Read-only firewall audit (may prompt for sudo). Does not modify rules.
set -euo pipefail

echo "=== Firewall audit (read-only) ==="
echo

if command -v ufw >/dev/null 2>&1; then
  sudo ufw status verbose || true
else
  echo "ufw: not installed"
fi

echo
echo "--- iptables (filter INPUT) ---"
sudo iptables -L INPUT -n -v 2>/dev/null || echo "iptables: not readable"

echo
echo "--- nftables ---"
sudo nft list ruleset 2>/dev/null | head -80 || echo "nft: not available"

echo
echo "--- Listening on 0.0.0.0 / :: ---"
ss -tulnp | grep -E '0\.0\.0\.0|\*|:::' || true

echo
echo "Expected public: 22, 80, 443, game ports, cm-proxy 18081-18100"
echo "Expected private: 3000, 6379, telemetry UDP 127.0.0.1"
