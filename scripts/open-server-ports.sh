#!/usr/bin/env bash
# Discover AC server folders under SERVERS_PATH and open public game/join ports
# (UDP+TCP game, TCP HTTP, TCP CM wrapper). Idempotent iptables ACCEPT rules.
#
# Default is dry-run. Use --apply (with sudo) to modify the host firewall.
# Plugin UDP (12xxx) and telemetry (9000–9020) stay closed — they bind locally.
#
# Usage:
#   ./scripts/open-server-ports.sh [--servers-path DIR] [--wrapper-offset N]
#   sudo ./scripts/open-server-ports.sh --servers-path DIR --apply
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLY=0
SERVERS_PATH_ARG=""
WRAPPER_OFFSET="${WRAPPER_PORT_OFFSET:-10000}"

usage() {
  cat <<'EOF'
Usage: open-server-ports.sh [options]

  --servers-path DIR   Path to servers/ (default: $SERVERS_PATH or from .env*)
  --wrapper-offset N   HTTP_PORT + N for CM wrapper if JSON missing (default 10000)
  --apply              Add missing iptables INPUT ACCEPT rules (requires root)
  --dry-run            Print only (default if --apply omitted)
  -h, --help           Show this help

Scans folders named server or server-N (skips server-template).
Reads UDP_PORT / TCP_PORT / HTTP_PORT from cfg/server_cfg.ini.
Wrapper port from cfg/cm_wrapper_params.json "port", else HTTP + offset.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --servers-path)
      SERVERS_PATH_ARG="${2:-}"
      shift 2
      ;;
    --wrapper-offset)
      WRAPPER_OFFSET="${2:-10000}"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --dry-run)
      APPLY=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

load_servers_path_from_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  local line
  line="$(grep -E '^[[:space:]]*SERVERS_PATH=' "$file" | tail -n1 || true)"
  [[ -n "$line" ]] || return 1
  line="${line#SERVERS_PATH=}"
  line="${line%%#*}"
  line="${line//\"/}"
  line="${line//\'/}"
  line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -n "$line" ]] || return 1
  echo "$line"
}

resolve_servers_path() {
  if [[ -n "$SERVERS_PATH_ARG" ]]; then
    echo "$SERVERS_PATH_ARG"
    return
  fi
  if [[ -n "${SERVERS_PATH:-}" ]]; then
    echo "$SERVERS_PATH"
    return
  fi
  local candidate
  for candidate in \
    "${ASSETTO_ENV_FILE:-}" \
    "$ROOT/.env.production" \
    "$ROOT/.env.local" \
    "$ROOT/.env"; do
    [[ -n "$candidate" ]] || continue
    if path="$(load_servers_path_from_env_file "$candidate" 2>/dev/null)"; then
      echo "$path"
      return
    fi
  done
  echo ""
}

ini_field() {
  local file="$1"
  local field="$2"
  local line
  line="$(grep -E "^${field}=" "$file" 2>/dev/null | head -n1 || true)"
  [[ -n "$line" ]] || return 1
  echo "${line#${field}=}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

wrapper_port_from_json() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
try:
  with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
  port = data.get("port")
  if isinstance(port, int) and port > 0:
    print(port)
  elif isinstance(port, str) and port.strip().isdigit():
    print(int(port.strip()))
  else:
    sys.exit(1)
except Exception:
  sys.exit(1)
' "$file" 2>/dev/null
  else
    local raw
    raw="$(grep -oE '"port"[[:space:]]*:[[:space:]]*[0-9]+' "$file" | head -n1 || true)"
    [[ -n "$raw" ]] || return 1
    echo "${raw##*:}" | tr -d '[:space:]'
  fi
}

# Unique sorted numeric ports collected for cloud checklist
declare -a GAME_UDP=()
declare -a GAME_TCP=()
declare -a HTTP_TCP=()
declare -a WRAPPER_TCP=()

add_unique() {
  local -n arr=$1
  local val="$2"
  [[ -n "$val" && "$val" =~ ^[0-9]+$ ]] || return 0
  local x
  for x in "${arr[@]+"${arr[@]}"}"; do
    [[ "$x" == "$val" ]] && return 0
  done
  arr+=("$val")
}

iptables_has() {
  local proto="$1"
  local port="$2"
  iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null
}

iptables_ensure() {
  local proto="$1"
  local port="$2"
  local label="$3"
  if [[ "$APPLY" -eq 0 ]]; then
    echo "  would  ACCEPT $proto/$port ($label)"
    return 0
  fi
  if iptables_has "$proto" "$port"; then
    echo "  skip  $proto/$port ($label) — already open"
    return 0
  fi
  iptables -A INPUT -p "$proto" --dport "$port" -j ACCEPT
  echo "  added ACCEPT $proto/$port ($label)"
}

SERVERS_PATH="$(resolve_servers_path)"
if [[ -z "$SERVERS_PATH" ]]; then
  echo "SERVERS_PATH not set. Pass --servers-path or export SERVERS_PATH." >&2
  exit 1
fi
if [[ ! -d "$SERVERS_PATH" ]]; then
  echo "SERVERS_PATH is not a directory: $SERVERS_PATH" >&2
  exit 1
fi

if [[ "$APPLY" -eq 1 && "$(id -u)" -ne 0 ]]; then
  echo "Apply mode requires root (sudo)." >&2
  exit 1
fi

if [[ "$APPLY" -eq 1 ]] && ! command -v iptables >/dev/null 2>&1; then
  echo "iptables not found." >&2
  exit 1
fi

echo "=== Open AC server ports ==="
echo "SERVERS_PATH=$SERVERS_PATH"
echo "wrapper_offset=$WRAPPER_OFFSET"
if [[ "$APPLY" -eq 1 ]]; then
  echo "mode=APPLY"
else
  echo "mode=DRY-RUN (pass --apply to modify iptables)"
fi
echo

found=0
shopt -s nullglob
for dir in "$SERVERS_PATH"/server "$SERVERS_PATH"/server-[0-9]*; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  if [[ "$name" == "server-template" ]]; then
    continue
  fi
  if [[ "$name" != "server" && ! "$name" =~ ^server-[0-9]+$ ]]; then
    continue
  fi

  cfg="$dir/cfg/server_cfg.ini"
  if [[ ! -f "$cfg" ]]; then
    echo "[$name] skip — missing cfg/server_cfg.ini"
    continue
  fi

  udp="$(ini_field "$cfg" UDP_PORT || true)"
  tcp="$(ini_field "$cfg" TCP_PORT || true)"
  http="$(ini_field "$cfg" HTTP_PORT || true)"
  [[ -n "$tcp" ]] || tcp="$udp"

  wrapper=""
  if w="$(wrapper_port_from_json "$dir/cfg/cm_wrapper_params.json" 2>/dev/null)"; then
    wrapper="$w"
  elif [[ -n "$http" && "$http" =~ ^[0-9]+$ ]]; then
    wrapper=$((http + WRAPPER_OFFSET))
  fi

  found=$((found + 1))
  echo "[$name] udp=${udp:-?} tcp=${tcp:-?} http=${http:-?} wrapper=${wrapper:-?}"

  if [[ -n "$udp" ]]; then
    add_unique GAME_UDP "$udp"
    iptables_ensure udp "$udp" "$name game UDP"
  fi
  if [[ -n "$tcp" ]]; then
    add_unique GAME_TCP "$tcp"
    iptables_ensure tcp "$tcp" "$name game TCP"
  fi
  if [[ -n "$http" ]]; then
    add_unique HTTP_TCP "$http"
    iptables_ensure tcp "$http" "$name HTTP"
  fi
  if [[ -n "$wrapper" ]]; then
    add_unique WRAPPER_TCP "$wrapper"
    iptables_ensure tcp "$wrapper" "$name CM wrapper"
  fi
  echo
done
shopt -u nullglob

if [[ "$found" -eq 0 ]]; then
  echo "No server / server-N folders with cfg found under $SERVERS_PATH" >&2
  exit 1
fi

sort_ports() {
  printf '%s\n' "$@" | sort -n | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

echo "=== Summary ($found instances) ==="
echo "Game UDP:    $(sort_ports "${GAME_UDP[@]+"${GAME_UDP[@]}"}")"
echo "Game TCP:    $(sort_ports "${GAME_TCP[@]+"${GAME_TCP[@]}"}")"
echo "HTTP TCP:    $(sort_ports "${HTTP_TCP[@]+"${HTTP_TCP[@]}"}")"
echo "Wrapper TCP: $(sort_ports "${WRAPPER_TCP[@]+"${WRAPPER_TCP[@]}"}")"
echo
echo "Not opened (local-only): plugin UDP 12xxx, telemetry 9000–9020"
echo
echo "=== Cloud / panel firewall ==="
echo "If the provider has a separate firewall (Contabo, Hetzner, AWS SG, etc.),"
echo "allow the same ports inbound from 0.0.0.0/0 (or your player CIDRs):"
echo "  UDP: $(sort_ports "${GAME_UDP[@]+"${GAME_UDP[@]}"}")"
echo "  TCP: $(sort_ports "${GAME_TCP[@]+"${GAME_TCP[@]}"}" "${HTTP_TCP[@]+"${HTTP_TCP[@]}"}" "${WRAPPER_TCP[@]+"${WRAPPER_TCP[@]}"}")"
echo

if [[ "$APPLY" -eq 1 ]]; then
  echo "Persist iptables across reboot if needed, e.g.:"
  echo "  sudo apt-get install -y iptables-persistent"
  echo "  sudo netfilter-persistent save"
  echo "  # or: sudo iptables-save | sudo tee /etc/iptables/rules.v4"
else
  echo "Dry-run only. Re-run with: sudo $0 --servers-path \"$SERVERS_PATH\" --apply"
fi
