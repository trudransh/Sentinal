#!/usr/bin/env bash
# Run from repo root:
#   bash scripts/probes/shutdown-a2.sh
set -euo pipefail

echo "[A2] stopping cloudflared tunnel processes..."
pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null || true

echo "[A2] stopping Next dev server processes..."
pkill -f "next dev -p 3000" 2>/dev/null || true
pkill -f "pnpm -F @sentinel/app dev" 2>/dev/null || true

sleep 1

if (ss -ltn 2>/dev/null || true) | awk '{print $4}' | rg -q '(:|^)3000$'; then
  echo "[A2] warning: port 3000 still in use"
  echo "     run: lsof -i :3000"
else
  echo "[A2] port 3000 is free"
fi

echo "[A2] done."
