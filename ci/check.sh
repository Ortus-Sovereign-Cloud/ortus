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
done
echo "all checks passed"
