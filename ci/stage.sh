#!/usr/bin/env bash
# Copies this checkout and the pinned parts into <dir> for a Docker build
# (Docker cannot follow the links ORTUS_DEPS_CACHE makes), without their
# build output.
set -euo pipefail
cd "$(dirname "$0")/.."
stage="$1"
mkdir -p "$stage"
skip=(--exclude target --exclude .git --exclude node_modules --exclude test-results)
rsync -a "${skip[@]}" --exclude .deps ./ "$stage/"
mkdir -p "$stage/.deps"
for dep in .deps/*/; do
  name="$(basename "$dep")"
  rsync -aL "${skip[@]}" "$dep" "$stage/.deps/$name/"
done
