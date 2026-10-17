#!/usr/bin/env bash
# Probe edge/hub liveness and/or readiness with HTTP status + timeout.
# Exit 0 only if all selected URLs return 2xx. Optional webhook does not hide probe failure.
#
# Usage:
#   ./scripts/resilience-probe.sh
#   ./scripts/resilience-probe.sh --check=live
#   ./scripts/resilience-probe.sh --check=health
#   ./scripts/resilience-probe.sh --check=both
#   LIVE_URLS='http://127.0.0.1:3000/api/live' ./scripts/resilience-probe.sh
#   HEALTH_URLS='http://127.0.0.1:3000/api/health' ./scripts/resilience-probe.sh --check=health
#   ALERT_WEBHOOK_URL=https://hooks.example/… ./scripts/resilience-probe.sh

set -euo pipefail

TIMEOUT_SEC="${PROBE_TIMEOUT_SEC:-5}"
LIVE_DEFAULT="${LIVE_URLS:-http://127.0.0.1:3000/api/live}"
HEALTH_DEFAULT="${HEALTH_URLS:-http://127.0.0.1:3000/api/health}"
CHECK="${PROBE_CHECK:-live}"

for arg in "$@"; do
  case "$arg" in
    --check=live|--check=health|--check=both)
      CHECK="${arg#--check=}"
      ;;
    -h|--help)
      echo "Usage: $0 [--check=live|health|both]"
      echo "  LIVE_URLS / HEALTH_URLS — comma-separated URLs"
      echo "  PROBE_TIMEOUT_SEC — curl max-time (default 5)"
      exit 0
      ;;
  esac
done

FAILED=0
MESSAGES=()

probe_one() {
  local url="$1"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT_SEC" "$url" 2>/dev/null || echo '000')"
  if [[ "$code" =~ ^2 ]]; then
    echo "OK  $code  $url"
    return 0
  fi
  echo "FAIL $code  $url" >&2
  MESSAGES+=("FAIL $code $url")
  return 1
}

probe_list() {
  local urls="$1"
  local IFS=','
  # shellcheck disable=SC2086
  read -r -a url_arr <<< "$urls"
  for raw in "${url_arr[@]}"; do
    url="$(echo "$raw" | tr -d '[:space:]')"
    [[ -z "$url" ]] && continue
    if ! probe_one "$url"; then
      FAILED=1
    fi
  done
}

case "$CHECK" in
  live)
    probe_list "$LIVE_DEFAULT"
    ;;
  health)
    probe_list "$HEALTH_DEFAULT"
    ;;
  both)
    probe_list "$LIVE_DEFAULT"
    probe_list "$HEALTH_DEFAULT"
    ;;
  *)
    echo "unknown --check=$CHECK (use live|health|both)" >&2
    exit 2
    ;;
esac

notify_webhook() {
  local body="$1"
  local wh="${ALERT_WEBHOOK_URL:-}"
  [[ -z "$wh" ]] && return 0
  if ! curl -sS --max-time "$TIMEOUT_SEC" -H 'Content-Type: application/json' \
    -d "$body" "$wh" >/dev/null 2>&1; then
    echo "WARN webhook POST failed (does not clear probe failure)" >&2
    return 1
  fi
  return 0
}

if [[ "$FAILED" -ne 0 ]]; then
  payload="$(printf '{"ok":false,"source":"resilience-probe","check":"%s","failures":%s}' \
    "$CHECK" \
    "$(printf '%s\n' "${MESSAGES[@]}" | jq -R . | jq -s . 2>/dev/null || echo '[]')")"
  notify_webhook "$payload" || true
  exit 1
fi

notify_webhook "$(printf '{"ok":true,"source":"resilience-probe","check":"%s"}' "$CHECK")" || true
exit 0
