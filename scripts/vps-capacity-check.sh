#!/bin/bash
# Quick VPS capacity snapshot for AC multi-instance hosts.
# Usage: ./scripts/vps-capacity-check.sh

set -e

echo "=== Memory ==="
free -h

echo ""
echo "=== CPU ==="
echo "cores: $(nproc)"
uptime

echo ""
echo "=== AC / stack processes (top by RSS) ==="
ps aux --sort=-%mem 2>/dev/null | grep -E '[a]cServer|[t]sx.*src/index|[p]ython.*main' | head -20 || true

echo ""
echo "=== acServer instance count ==="
pgrep -cf acServer 2>/dev/null || echo 0

echo ""
echo "=== Game + plugin UDP listeners (96xx / 120xx) ==="
ss -ulnp 2>/dev/null | grep -E '120[0-9]{2}|96[0-9]{2}' | wc -l

echo ""
echo "=== Per acServer RSS (MB) ==="
ps -o rss=,args= -C acServer 2>/dev/null | awk '{printf "%.1f MB  %s\n", $1/1024, substr($0,index($0,$2))}' | head -20 || echo "(none)"
