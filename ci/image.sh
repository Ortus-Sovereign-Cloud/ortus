#!/usr/bin/env bash
# Builds the container image of one program from this checkout and the
# pinned parts: ci/image.sh [program] [tag], as ci/image.sh ortus ortus:dev.
# The parts are copied into a staging directory (Docker cannot follow the
# links ORTUS_DEPS_CACHE makes), without their build output.
set -euo pipefail
cd "$(dirname "$0")/.."
program="${1:-ortus}"
tag="${2:-$program:dev}"
ci/fetch.sh >/dev/null
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
ci/stage.sh "$stage"
docker build -q --build-arg "PROGRAM=$program" -t "$tag" "$stage" >/dev/null
echo "image: $tag ($program)"
