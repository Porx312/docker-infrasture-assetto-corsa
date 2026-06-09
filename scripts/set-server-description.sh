#!/bin/bash
# Set DESCRIPTION and WEBLINK in all server_cfg.ini files from server-branding.json.
#
# Usage:
#   ./scripts/set-server-description.sh
#   ./scripts/set-server-description.sh /path/to/custom-branding.json

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANDING_FILE="${1:-$ROOT/server/shared/server-branding.json}"

if [ ! -f "$BRANDING_FILE" ]; then
  echo "Error: branding file not found: $BRANDING_FILE" >&2
  exit 1
fi

DESCRIPTION="$(python3 -c "import json; print(json.load(open('$BRANDING_FILE'))['description'])")"
WEBLINK="$(python3 -c "import json; print(json.load(open('$BRANDING_FILE'))['webLink'])")"

update_ini() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Skip (missing): $file"
    return
  fi
  perl -i -pe '
    BEGIN {
      $desc = $ENV{DESC};
      $web = $ENV{WEB};
    }
    if (/^DESCRIPTION=/) { $_ = "DESCRIPTION=$desc\n"; }
    elsif (/^WEBLINK=/) { $_ = "WEBLINK=$web\n"; }
  ' "$file"
  echo "Updated: $file"
}

export DESC="$DESCRIPTION"
export WEB="$WEBLINK"

for n in server server-{1..19}; do
  update_ini "$ROOT/server/$n/cfg/server_cfg.ini"
done

update_ini "$ROOT/server-templates/server-template/cfg/server_cfg.ini"

echo "Done. DESCRIPTION and WEBLINK applied from $BRANDING_FILE"
