#!/usr/bin/env bash
# Compare two HUD load test JSON reports (p95, Redis, capacity points).
#
# Usage:
#   ./scripts/compare-hud-load-test-reports.sh BEFORE.json AFTER.json
#   ./scripts/compare-hud-load-test-reports.sh  # latest two in scripts/load-test-results/hud/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/scripts/load-test-results/hud"

before="${1:-}"
after="${2:-}"

if [[ -z "$before" || -z "$after" ]]; then
  mapfile -t files < <(ls -1t "$DIR"/hud-load-test-*.json 2>/dev/null | head -2)
  if [[ ${#files[@]} -lt 2 ]]; then
    echo "Need two report JSON files. Usage: $0 BEFORE.json AFTER.json"
    exit 1
  fi
  after="${files[0]}"
  before="${files[1]}"
fi

python3 <<PY
import json
import sys

def load(path):
    with open(path) as f:
        return json.load(f)

before = load("$before")
after = load("$after")

def level_map(report):
    return {l["clients"]: l for l in report.get("levels", [])}

b_levels = level_map(before)
a_levels = level_map(after)

print("=== HUD load test comparison ===")
print(f"Before: $before")
print(f"  target={before.get('target')} finished={before.get('finishedAt')}")
print(f"  safe={before.get('safeCapacity')} fail={before.get('failurePoint')}")
print(f"After:  $after")
print(f"  target={after.get('target')} finished={after.get('finishedAt')}")
print(f"  safe={after.get('safeCapacity')} fail={after.get('failurePoint')}")
print("")
print(f"{'Clients':>7} | {'p95 before':>10} | {'p95 after':>10} | {'Redis before':>12} | {'Redis after':>12} | status")
print("-" * 75)

all_clients = sorted(set(b_levels) | set(a_levels))
for c in all_clients:
    bl = b_levels.get(c)
    al = a_levels.get(c)
    if not bl or not al:
        continue
    rb = bl.get("redisLatencyMs")
    ra = al.get("redisLatencyMs")
    rb_s = f"{rb:.1f}ms" if rb is not None else "n/a"
    ra_s = f"{ra:.1f}ms" if ra is not None else "n/a"
    print(
        f"{c:>7} | {bl['p95Ms']:>8.0f}ms | {al['p95Ms']:>8.0f}ms | {rb_s:>12} | {ra_s:>12} | {al['status']}"
    )

print("")
if after.get("safeCapacity") and before.get("safeCapacity"):
    delta = (after["safeCapacity"] or 0) - (before["safeCapacity"] or 0)
    print(f"Safe capacity delta: {delta:+d} HUDs")
PY
