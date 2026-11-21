#!/usr/bin/env bash
# Every check CI runs, in the same order. Run it before each push.
set -euo pipefail
cd "$(dirname "$0")/.."
ci/fetch.sh
for script in ci/*.sh install/*.sh; do bash -n "$script"; done
if command -v shellcheck >/dev/null; then shellcheck -S warning ci/*.sh install/*.sh; fi
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo deny check
ci/licence-gate-selftest.sh
cargo build --release
ci/install-test.sh
# What the release publishes beside the programs, made from them and kept
# in the repository (the website takes the reference from here): the API
# reference, the commands, the licences. ORTUS_UPDATE_REFERENCE=1 rewrites.
mkdir -p api
target/release/ortus reference > target/openapi.json
target/release/ortus help | sed -n 's/^  \([a-z][a-z-]*\).*/\1/p' | sort -u > target/commands.txt
python3 tools/licences.py > target/LICENSES.md
# Every ORTUS_* setting the programs read (the guide may name only these).
grep -rhoE 'ORTUS_[A-Z0-9_]+[A-Z0-9]' .deps/*/src programs/*/src install | sort -u > target/settings.txt
for f in api/openapi.json api/commands.txt api/settings.txt LICENSES.md; do
  made="target/$(basename "$f")"
  if [ -n "${ORTUS_UPDATE_REFERENCE:-}" ]; then cp "$made" "$f"; fi
  cmp -s "$made" "$f" || { echo "check: $f is stale: run ORTUS_UPDATE_REFERENCE=1 ci/check.sh and commit it" >&2; exit 1; }
done
# The story steps, in the browser, against the release program, in each
# shape: one-machine (SQLite and a directory) and cluster (PostgreSQL and
# S3, which need ORTUS_TEST_POSTGRES and ORTUS_TEST_S3_*).
(cd stories && npm ci --silent && npx tsc --noEmit)
for shape in ${ORTUS_STORY_SHAPES:-one-machine cluster}; do
  if [ "$shape" = cluster ] && [ -z "${ORTUS_TEST_POSTGRES:-}" ]; then
    if [ -n "${ORTUS_REQUIRE_POSTGRES:-}" ]; then echo "check: the cluster shape needs ORTUS_TEST_POSTGRES" >&2; exit 1; fi
    echo "check: skipped the cluster shape (set ORTUS_TEST_POSTGRES and ORTUS_TEST_S3_*)"
    continue
  fi
  (cd stories && ORTUS_STORY_SHAPE="$shape" npx playwright test && node tools/coverage.mjs | tail -n 1)
  # Many people at once, within latency and error budgets (a small size
  # here; LOAD_PEOPLE and LOAD_SECONDS make it larger).
  (cd stories && ORTUS_STORY_SHAPE="$shape" node load/load.ts | tail -n 16)
done
echo "all checks passed"
