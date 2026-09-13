#!/usr/bin/env bash
# Live verification for the turn-completion observer (REQ-1 / issue #34).
# Boots the bundled dsh in a throwaway DSH_HOME and drives the real transport
# against it. Requires a built desktop package (pnpm run build).
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f packages/uniterra-desktop/dist/dsh-observer.js ] \
  || { echo "FAIL: build first (pnpm run build)"; exit 1; }
exec node scripts/verify-turn-notification/verify.mjs
