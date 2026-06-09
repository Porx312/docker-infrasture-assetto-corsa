#!/bin/bash
# Generate cfg/cm_wrapper_params.json for each AC server instance.
# Wrapper HTTP port = game HTTP_PORT + WRAPPER_PORT_OFFSET (default 10000).
#
# Usage:
#   ./scripts/generate-cm-wrapper-params.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANDING_FILE="${BRANDING_FILE:-$ROOT/server/shared/server-branding.json}"
OFFSET="${WRAPPER_PORT_OFFSET:-10000}"

if [ ! -f "$BRANDING_FILE" ]; then
  echo "Error: branding file not found: $BRANDING_FILE" >&2
  exit 1
fi

CM_DESC="$(python3 - "$BRANDING_FILE" <<'PY'
import json, sys
from pathlib import Path
d = json.loads(Path(sys.argv[1]).read_text())
body = d.get("cmDescriptionBody") or d.get("cmDescription") or d["description"]
banner = (d.get("bannerImageUrl") or d.get("loadingImageUrl") or "").strip()
# CM BBCode: one banner above text — use closing [/img] (avoids duplicate renders)
if banner:
    print(f"[img={banner}]ProjectD[/img]\n\n{body}")
else:
    print(body)
PY
)"
LOADING_URL="$(python3 -c "import json; d=json.load(open('$BRANDING_FILE')); print(d.get('loadingImageUrl', ''))")"

generate_one() {
  local cfg_ini="$1"
  local out_json="$2"
  if [ ! -f "$cfg_ini" ]; then
    echo "Skip (missing): $cfg_ini"
    return
  fi
  local http_port
  http_port="$(grep -m1 '^HTTP_PORT=' "$cfg_ini" | cut -d= -f2)"
  if [ -z "$http_port" ] || ! [[ "$http_port" =~ ^[0-9]+$ ]]; then
    echo "Skip (invalid HTTP_PORT): $cfg_ini"
    return
  fi
  local wrapper_port=$((http_port + OFFSET))
  python3 - "$out_json" "$wrapper_port" "$CM_DESC" "$LOADING_URL" <<'PY'
import json, sys
out, port, desc, loading = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
data = {
    "description": desc,
    "port": port,
    "verboseLog": False,
    "downloadSpeedLimit": 0,
    "downloadPasswordOnly": False,
    "publishPasswordChecksum": True,
}
if loading:
    data["loadingImageUrl"] = loading
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
  echo "Generated: $out_json (port $wrapper_port)"
}

for n in server server-{1..19}; do
  generate_one \
    "$ROOT/server/$n/cfg/server_cfg.ini" \
    "$ROOT/server/$n/cfg/cm_wrapper_params.json"
done

mkdir -p "$ROOT/server-templates/server-template/cfg"
generate_one \
  "$ROOT/server-templates/server-template/cfg/server_cfg.ini" \
  "$ROOT/server-templates/server-template/cfg/cm_wrapper_params.json"

echo "Done."
