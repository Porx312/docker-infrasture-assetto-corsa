#!/usr/bin/env bash
# Remove secrets from git history for config.yml (DESTRUCTIVE — requires force-push approval).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "This script rewrites git history to remove config.yml credentials."
echo "Prerequisites:"
echo "  1. config.yml removed from tracking (git rm --cached config.yml)"
echo "  2. config.yml added to .gitignore"
echo "  3. Steam password rotated in Steam account"
echo "  4. Team notified — all clones must re-clone or reset"
echo
read -r -p "Continue? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || exit 0

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "Install git-filter-repo: pip install git-filter-repo" >&2
  exit 1
fi

git filter-repo --path config.yml --invert-paths --force
echo "Done. Verify with: git log --all -- config.yml"
echo "Then: git push --force-with-lease origin main  (only after team approval)"
