#!/usr/bin/env bash
# Fix per-instance acServer/system links under SERVERS_PATH.
# Prefer relative targets (../acServer) so /home/jose and /root clones both work.
# Also rewrites absolute /home/jose/... → current repo prefix when needed.
#
# Usage:
#   ./scripts/fix-server-symlinks.sh [--servers-path DIR]
#   ./scripts/fix-server-symlinks.sh --servers-path DIR --apply
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLY=0
SERVERS_PATH_ARG=""
FROM_PREFIX="${FIX_SYMLINK_FROM:-/home/jose}"
TO_PREFIX="${FIX_SYMLINK_TO:-}"

usage() {
  cat <<'EOF'
Usage: fix-server-symlinks.sh [options]

  --servers-path DIR   Path to servers/ (default: $SERVERS_PATH or from .env*)
  --from PREFIX        Absolute path prefix to rewrite (default: /home/jose)
  --to PREFIX          Replacement prefix (default: dirname of SERVERS_PATH parent chain → repo root parent of servers, or /root if from is /home/jose)
  --apply              Write changes (default: dry-run)
  --dry-run            Print only (default)
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --servers-path) SERVERS_PATH_ARG="${2:-}"; shift 2 ;;
    --from) FROM_PREFIX="${2:-}"; shift 2 ;;
    --to) TO_PREFIX="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
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
  local candidate path
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
  # Common monorepo layout: <repo>/server
  if [[ -d "$ROOT/server" ]]; then
    echo "$ROOT/server"
    return
  fi
  echo ""
}

SERVERS_PATH="$(resolve_servers_path)"
if [[ -z "$SERVERS_PATH" || ! -d "$SERVERS_PATH" ]]; then
  echo "SERVERS_PATH missing or not a directory: ${SERVERS_PATH:-"(empty)"}" >&2
  exit 1
fi
SERVERS_PATH="$(cd "$SERVERS_PATH" && pwd)"

if [[ -z "$TO_PREFIX" ]]; then
  # SERVERS_PATH=/root/assetto-infra/server → rewrite /home/jose/assetto-infra → /root/assetto-infra
  # and /home/jose/assetto-install → /root/assetto-install (same parent as repo)
  TO_PREFIX="$(dirname "$(dirname "$SERVERS_PATH")")"
  if [[ "$FROM_PREFIX" == "/home/jose" && -d "/root" ]]; then
    # Prefer /root when SERVERS_PATH is under /root
    case "$SERVERS_PATH" in
      /root/*) TO_PREFIX="/root" ;;
    esac
  fi
fi

echo "=== Fix server symlinks ==="
echo "SERVERS_PATH=$SERVERS_PATH"
echo "rewrite: ${FROM_PREFIX}/… → ${TO_PREFIX}/…"
if [[ "$APPLY" -eq 1 ]]; then
  echo "mode=APPLY"
else
  echo "mode=DRY-RUN (pass --apply to write)"
fi
echo

ROOT_AC="$SERVERS_PATH/acServer"
ROOT_SYS="$SERVERS_PATH/system"
if [[ ! -e "$ROOT_AC" ]]; then
  echo "WARN: root binary missing: $ROOT_AC (instance links will still be created)" >&2
fi

link_rel() {
  local dest="$1"
  local rel_target="$2"
  local label="$3"
  if [[ -L "$dest" ]]; then
    local cur
    cur="$(readlink "$dest")"
    if [[ "$cur" == "$rel_target" ]] && [[ -e "$dest" || ! -e "$(dirname "$dest")/$rel_target" ]]; then
      # same relative target; if target missing that's a separate problem
      if [[ "$cur" == "$rel_target" ]]; then
        echo "  ok    $label → $rel_target"
        return 0
      fi
    fi
  elif [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "  keep  $label (real file, not a symlink)"
    return 0
  fi
  if [[ "$APPLY" -eq 0 ]]; then
    echo "  would ln -sfn $rel_target $dest"
    return 0
  fi
  rm -f "$dest"
  ln -sfn "$rel_target" "$dest"
  echo "  linked $label → $rel_target"
}

rewrite_abs_symlink() {
  local link="$1"
  [[ -L "$link" ]] || return 0
  local target new_target
  target="$(readlink "$link")"
  [[ "$target" == /* ]] || return 0
  case "$target" in
    "$FROM_PREFIX"/*)
      new_target="${TO_PREFIX}${target#"$FROM_PREFIX"}"
      ;;
    *)
      return 0
      ;;
  esac
  if [[ "$target" == "$new_target" ]]; then
    return 0
  fi
  if [[ "$APPLY" -eq 0 ]]; then
    echo "  would rewrite $link"
    echo "         $target"
    echo "      →  $new_target"
    return 0
  fi
  rm -f "$link"
  ln -sfn "$new_target" "$link"
  echo "  rewrote $link → $new_target"
}

# 1) Rewrite absolute /home/jose links anywhere under SERVERS_PATH
while IFS= read -r -d '' link; do
  rewrite_abs_symlink "$link"
done < <(find "$SERVERS_PATH" -type l -print0 2>/dev/null)

echo
echo "--- Per-instance acServer / system (relative) ---"

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
  echo "[$name]"
  link_rel "$dir/acServer" "../acServer" "acServer"
  if [[ -e "$ROOT_SYS" || -L "$ROOT_SYS" ]]; then
    link_rel "$dir/system" "../system" "system"
  fi
done
shopt -u nullglob

echo
echo "=== Verify ==="
ok=0
bad=0
shopt -s nullglob
for dir in "$SERVERS_PATH"/server "$SERVERS_PATH"/server-[0-9]*; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  [[ "$name" == "server" || "$name" =~ ^server-[0-9]+$ ]] || continue
  if [[ -e "$dir/acServer" ]]; then
    ok=$((ok + 1))
  else
    bad=$((bad + 1))
    echo "MISSING $dir/acServer"
  fi
done
shopt -u nullglob
echo "instances with resolvable acServer: $ok"
echo "instances missing acServer: $bad"
if [[ "$APPLY" -eq 0 ]]; then
  echo
  echo "Dry-run only. Re-run with: $0 --servers-path \"$SERVERS_PATH\" --apply"
fi
