#!/usr/bin/env bash
# dsh-shortcuts smoke: boot a REAL dsh web profile (sandbox DSH_HOME) from the
# npm-linked CLI, provision the vendored plugin the way the desktop's
# copy-based built-in path does, reboot, and assert the integration seams:
#  - the boot graph (__DSH_BOOT__) carries a dsh-shortcuts entry,
#  - /plugins/dsh-shortcuts/client.js serves the bundle (200),
#  - the host half registered /dsh-shortcuts-permission (400 on missing params),
#  - no boot-page 'did not activate' failure text.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DSH_CLI="$REPO_ROOT/packages/uniterra-desktop/node_modules/@deepseek-ai/dsh/lib/bin.js"
VENDOR_DIR="$REPO_ROOT/vendor/dsh-plugins/dsh-shortcuts"

if [ ! -f "$DSH_CLI" ]; then
  echo "SKIP: dsh CLI not linked at $DSH_CLI"
  exit 0
fi

HOME_DIR=$(mktemp -d "${TMPDIR:-/tmp}/dsh-shortcuts-smoke.XXXXXX")
DSH_PID=''
cleanup() {
  if [ -n "$DSH_PID" ]; then kill "$DSH_PID" 2>/dev/null || true; fi
  rm -rf "$HOME_DIR"
}
trap cleanup EXIT

boot() {
  DSH_HOME="$HOME_DIR" node "$DSH_CLI" web --port 0 --no-open > "$HOME_DIR/boot.log" 2>&1 &
  DSH_PID=$!
  URL=''
  for _ in $(seq 1 60); do
    URL=$(grep -o 'http://127.0.0.1:[0-9]*' "$HOME_DIR/boot.log" | head -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -z "$URL" ]; then
    echo "FAIL: dsh web never started"; cat "$HOME_DIR/boot.log"; exit 1
  fi
}

boot
TOKEN=$(grep -o 'token=[^ ]*' "$HOME_DIR/boot.log" | head -1 | sed 's/token=//')
BASE="$URL/?token=$TOKEN"

# 1. Baseline: without the plugin, the bundle route must be absent.
curl -s -c "$HOME_DIR/cookies" -L "$BASE" -o "$HOME_DIR/before.html"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/plugins/dsh-shortcuts/client.js")
if [ "$CODE" = "200" ]; then
  echo "FAIL: shortcuts bundle served before provisioning"; exit 1
fi
echo "baseline: bundle route absent ($CODE)"

# 2. Provision exactly like the desktop's copy-based built-in path.
PROFILE="$HOME_DIR/profiles/web"
mkdir -p "$PROFILE/node_modules"
rm -rf "$PROFILE/node_modules/dsh-shortcuts"
cp -R "$VENDOR_DIR" "$PROFILE/node_modules/dsh-shortcuts"
node --input-type=module --eval "
  import { readFileSync, writeFileSync } from 'node:fs';
  const p = '$PROFILE/package.json';
  const m = JSON.parse(readFileSync(p, 'utf8'));
  m.dsh ??= {}; m.dsh.profile ??= {}; m.dsh.profile.bundles ??= [];
  if (!m.dsh.profile.bundles.includes('dsh-shortcuts')) m.dsh.profile.bundles.push('dsh-shortcuts');
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
"

# 3. Reboot and assert the full seam.
kill "$DSH_PID" 2>/dev/null || true; wait "$DSH_PID" 2>/dev/null || true
boot
TOKEN=$(grep -o 'token=[^ ]*' "$HOME_DIR/boot.log" | head -1 | sed 's/token=//')
BASE="$URL/?token=$TOKEN"

# The index only carries the boot graph once the loader composed it; poll.
for _ in $(seq 1 60); do
  curl -s -c "$HOME_DIR/cookies" -L "$BASE" -o "$HOME_DIR/after.html"
  if grep -q "__DSH_BOOT__" "$HOME_DIR/after.html"; then break; fi
  sleep 1
done

if ! grep -q "dsh-shortcuts" "$HOME_DIR/after.html"; then
  echo 'FAIL: boot graph has no dsh-shortcuts entry';
  grep -o 'did not activate[^"]*' "$HOME_DIR/after.html" || true;
  exit 1
fi
echo 'boot graph: dsh-shortcuts entry present'

if grep -q 'did not activate' "$HOME_DIR/after.html"; then
  echo 'FAIL: web boot reports entries that did not activate';
  grep -o 'web boot: [^<]*' "$HOME_DIR/after.html" | head -3;
  exit 1
fi
echo 'no boot failure text'

BUNDLE_URL=$(grep -o '/plugins/[^"]*??dsh-shortcuts/client\.js[^"]*' "$HOME_DIR/after.html" | head -1 | sed 's/&amp;/\&/g')
if [ -z "$BUNDLE_URL" ]; then
  echo 'FAIL: could not resolve the dsh-shortcuts bundle URL from the boot graph'; exit 1
fi
CODE=$(curl -s -o "$HOME_DIR/bundle.js" -w '%{http_code}' "$URL$BUNDLE_URL")
if [ "$CODE" != "200" ]; then
  echo "FAIL: bundle route got $CODE for $BUNDLE_URL"; exit 1
fi
if ! grep -q '__ModuleLoader__.load' "$HOME_DIR/bundle.js"; then
  echo 'FAIL: bundle body is not the expected factory script'; exit 1
fi
echo 'bundle route: 200 with factory registration'
# 4. Host half: the permission route answers 400 (missing params) — registered.
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/dsh-shortcuts-permission")
if [ "$CODE" != "400" ]; then
  echo "FAIL: /dsh-shortcuts-permission not registered (got $CODE)"; exit 1
fi
echo 'host route: /dsh-shortcuts-permission registered (400 without params)'

echo 'SMOKE OK'