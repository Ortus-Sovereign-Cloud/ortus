#!/usr/bin/env bash
# Checks out every part named in pins.toml at its pinned commit under
# .deps/<name>, and builds its web client when it has one. A checkout that
# is already at its pin is left alone.
set -euo pipefail
cd "$(dirname "$0")/.."
org="${ORTUS_GIT_BASE:-https://github.com/Ortus-Sovereign-Cloud}"
mkdir -p .deps
grep -E '^[a-z0-9-]+ = "[0-9a-f]{40}"$' pins.toml | while read -r name _ quoted; do
  rev="${quoted//\"/}"
  dir=".deps/$name"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$org/$name.git"
  fi
  if [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$rev" ]; then
    git -C "$dir" fetch -q --depth 1 origin "$rev"
    git -C "$dir" checkout -q --force "$rev"
    rm -f "$dir/.web-built"
  fi
  if [ -f "$dir/web/package.json" ] && [ ! -f "$dir/.web-built" ]; then
    (cd "$dir/web" && npm ci --silent && npm run build --silent)
    touch "$dir/.web-built"
  fi
  echo "fetch: $name at ${rev:0:12}"
done
