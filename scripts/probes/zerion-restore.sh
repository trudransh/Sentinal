#!/usr/bin/env bash
# Emergency restore for zerion-capture-ctx.sh.
# Use only if the trap ever failed (kill -9, OOM kill, etc.) and your
# Zerion install's deny-transfers.mjs is still our probe content.
#
# Run from repo root: bash scripts/probes/zerion-restore.sh

set -euo pipefail

ZERION_POL_DIR="${ZERION_POL_DIR:-$(npm root -g 2>/dev/null)/zerion-cli/cli/policies}"
TARGET="$ZERION_POL_DIR/deny-transfers.mjs"

if [[ ! -d "$ZERION_POL_DIR" ]]; then
  echo "ERROR: $ZERION_POL_DIR not found"
  exit 1
fi

# Find most recent backup
shopt -s nullglob
BACKUPS=(/tmp/deny-transfers.mjs.bak.*)
if (( ${#BACKUPS[@]} == 0 )); then
  echo "ERROR: no /tmp/deny-transfers.mjs.bak.* backups found."
  echo "       If your install is broken, reinstall: npm i -g zerion-cli"
  exit 1
fi

# Pick the newest
LATEST=$(ls -t /tmp/deny-transfers.mjs.bak.* 2>/dev/null | head -1)
echo "[restore] using   : $LATEST"
echo "[restore] target  : $TARGET"

# Sanity: target should be the probe content (so we know we're not blowing away a real file)
if grep -q "sentinel-probe" "$TARGET" 2>/dev/null; then
  echo "[restore] confirmed target is patched (contains 'sentinel-probe')"
else
  read -p "[restore] target does NOT look patched. Restore anyway? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

cp "$LATEST" "$TARGET"
echo "[restore] OK — $TARGET restored from $LATEST"
echo "[restore] you can now delete the backup: rm '$LATEST'"
