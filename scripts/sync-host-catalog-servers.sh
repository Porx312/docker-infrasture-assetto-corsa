#!/usr/bin/env bash
# On an edge VPS: scan SERVERS_PATH folders and force-upsert them to Convex via the hub.
#
# Usage:
#   ./scripts/sync-host-catalog-servers.sh
#   ./scripts/sync-host-catalog-servers.sh --servers-path /root/assetto-infra/server
#   ./scripts/sync-host-catalog-servers.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
SERVERS_PATH_ARG=""
INSTANCE_ID_ARG=""
REGION_ARG=""
HUB_URL_ARG=""

usage() {
  cat <<'EOF'
Usage: sync-host-catalog-servers.sh [options]

  --servers-path DIR   AC servers root (default: $SERVERS_PATH / .env*)
  --instance-id ID     AC_INSTANCE_ID (default: from env)
  --region CODE        EU|NA|SA|APAC (optional; hub may resolve from fleet)
  --hub-url URL        Hub base (default: BACKEND_WORKER_URL / BACKEND_INGEST_URL)
  --dry-run            Print JSON payload; do not POST
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --servers-path) SERVERS_PATH_ARG="${2:-}"; shift 2 ;;
    --instance-id) INSTANCE_ID_ARG="${2:-}"; shift 2 ;;
    --region) REGION_ARG="${2:-}"; shift 2 ;;
    --hub-url) HUB_URL_ARG="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # shellcheck disable=SC1090
  set -a
  # Only export simple KEY=VALUE lines (no command substitution).
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      val="${val%%#*}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      val="$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      export "$key=$val"
    fi
  done < "$file"
  set +a
}

for f in "${ASSETTO_ENV_FILE:-}" "$ROOT/.env.local" "$ROOT/.env.production" "$ROOT/.env"; do
  [[ -n "$f" ]] || continue
  load_env_file "$f"
done

SERVERS_PATH="${SERVERS_PATH_ARG:-${SERVERS_PATH:-}}"
if [[ -z "$SERVERS_PATH" && -d "$ROOT/server" ]]; then
  SERVERS_PATH="$ROOT/server"
fi
INSTANCE_ID="${INSTANCE_ID_ARG:-${AC_INSTANCE_ID:-}}"
REGION="${REGION_ARG:-${AC_REGION:-${HOST_CATALOG_DEFAULT_REGION:-}}}"
HUB_URL="${HUB_URL_ARG:-${BACKEND_WORKER_URL:-${BACKEND_INGEST_URL:-}}}"
HUB_URL="${HUB_URL%/}"
# Same secret as agent presence (fleetEdgeSecret on edge).
SECRET="${FLEET_EDGE_SECRET:-${CONVEX_WORKER_SECRET:-}}"

if [[ -z "$SERVERS_PATH" || ! -d "$SERVERS_PATH" ]]; then
  echo "SERVERS_PATH missing or not a directory" >&2
  exit 1
fi
if [[ -z "$INSTANCE_ID" ]]; then
  echo "AC_INSTANCE_ID / --instance-id required" >&2
  exit 1
fi
if [[ "$DRY_RUN" -eq 0 ]]; then
  if [[ -z "$HUB_URL" ]]; then
    echo "Hub URL missing (BACKEND_WORKER_URL or BACKEND_INGEST_URL)" >&2
    exit 1
  fi
  if [[ -z "$SECRET" ]]; then
    echo "FLEET_EDGE_SECRET (or CONVEX_WORKER_SECRET fallback) missing" >&2
    exit 1
  fi
fi

ini_http_port() {
  local cfg="$1"
  [[ -f "$cfg" ]] || return 1
  local line
  line="$(grep -E '^HTTP_PORT=' "$cfg" | head -n1 || true)"
  [[ -n "$line" ]] || return 1
  echo "${line#HTTP_PORT=}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# Build servers JSON array with python for safe escaping
SERVERS_JSON="$(
  python3 - "$SERVERS_PATH" <<'PY'
import json, os, re, sys
root = sys.argv[1]
entries = []
names = []
for name in sorted(os.listdir(root)):
    path = os.path.join(root, name)
    if not os.path.isdir(path):
        continue
    if name == "server-template":
        continue
    if name != "server" and not re.match(r"^server-\d+$", name):
        continue
    http_port = None
    cfg = os.path.join(path, "cfg", "server_cfg.ini")
    if os.path.isfile(cfg):
        with open(cfg, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("HTTP_PORT="):
                    raw = line.split("=", 1)[1].strip()
                    try:
                        http_port = int(raw)
                    except ValueError:
                        http_port = None
                    break
    row = {"serverId": name, "name": name, "status": "idle", "playerCount": 0}
    if http_port and http_port > 0:
        row["httpPort"] = http_port
    entries.append(row)
    names.append(name)
print(json.dumps({"servers": entries, "names": names}))
PY
)"

SERVER_COUNT="$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])["servers"]))' "$SERVERS_JSON")"
if [[ "$SERVER_COUNT" -eq 0 ]]; then
  echo "No server / server-N folders under $SERVERS_PATH" >&2
  exit 1
fi

PAYLOAD="$(
  python3 - "$INSTANCE_ID" "$REGION" "$SERVERS_JSON" <<'PY'
import json, sys
instance_id, region, blob = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.loads(blob)
out = {"instanceId": instance_id, "servers": data["servers"]}
if region.strip():
    out["region"] = region.strip()
print(json.dumps(out))
PY
)"

echo "=== sync-host-catalog-servers ==="
echo "SERVERS_PATH=$SERVERS_PATH"
echo "instanceId=$INSTANCE_ID"
echo "servers=$SERVER_COUNT"
echo "hub=${HUB_URL:-"(dry-run)"}"
echo

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "$PAYLOAD" | python3 -m json.tool
  echo
  echo "Dry-run only. Re-run without --dry-run to POST."
  exit 0
fi

URL="${HUB_URL}/v1/internal/host-catalog/sync-servers"
echo "POST $URL"
RESP="$(curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: $SECRET" \
  -d "$PAYLOAD")"
echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"

OK="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("ok", False))' "$RESP" 2>/dev/null || echo False)"
if [[ "$OK" != "True" ]]; then
  exit 1
fi
echo
echo "Done."
