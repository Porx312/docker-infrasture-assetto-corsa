#!/bin/bash
# Append Content Manager wrapper port suffix (ℹPORT) to NAME= in server_cfg.ini.
#
# Usage:
#   ./scripts/apply-cm-name-suffix.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

apply_one() {
  local cfg_ini="$1"
  local params_json="$2"
  if [ ! -f "$cfg_ini" ] || [ ! -f "$params_json" ]; then
    return
  fi
  python3 - "$cfg_ini" "$params_json" <<'PY'
import json, re, sys

LOBBY_NAME_MAX = 128

def utf8_byte_length(value: str) -> int:
    return len(value.encode("utf-8"))

def trim_base_to_fit(base: str, suffix: str) -> str:
    trimmed = base
    while (
        len(trimmed) + len(suffix) > LOBBY_NAME_MAX
        or utf8_byte_length(trimmed + suffix) > LOBBY_NAME_MAX
    ):
        if not trimmed:
            break
        trimmed = trimmed[:-1].rstrip()
    return trimmed

ini_path, params_path = sys.argv[1], sys.argv[2]
port = json.load(open(params_path))["port"]
sep = "\u2139"
content = open(ini_path, encoding="utf-8").read()
m = re.search(r"^NAME=(.*)$", content, re.M)
if not m:
    sys.exit(0)
name = m.group(1).strip()
if sep in name:
    base = name[: name.index(sep)].rstrip()
else:
    base = name
suffix = f" {sep}{port}"
base = trim_base_to_fit(base, suffix)
new_name = f"{base}{suffix}"
new_content = re.sub(r"^NAME=.*$", f"NAME={new_name}", content, count=1, flags=re.M)
if new_content != content:
    open(ini_path, "w", encoding="utf-8", newline="\n").write(new_content)
    print(f"Updated NAME in {ini_path}")
PY
}

for n in server server-{1..19}; do
  apply_one \
    "$ROOT/server/$n/cfg/server_cfg.ini" \
    "$ROOT/server/$n/cfg/cm_wrapper_params.json"
done

apply_one \
  "$ROOT/server-templates/server-template/cfg/server_cfg.ini" \
  "$ROOT/server-templates/server-template/cfg/cm_wrapper_params.json"

echo "Done."
