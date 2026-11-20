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
echo "all checks passed"
