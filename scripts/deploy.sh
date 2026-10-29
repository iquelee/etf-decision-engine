#!/usr/bin/env bash
set -euo pipefail
# Resolve this checkout; no fixed developer path, git pull, credential/proxy overrides,
# or implicit deployment of all cloud functions. Default action prints a local plan.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${NODE:-node}" "$SCRIPT_DIR/release-preflight.js" "$@"
