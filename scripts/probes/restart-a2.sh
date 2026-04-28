#!/usr/bin/env bash
# Run from repo root:
#   bash scripts/probes/restart-a2.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

require_env() {
  local k="$1"
  if [[ -z "${!k:-}" ]]; then
    echo "[A2] missing env: $k"
    exit 1
  fi
}

require_env HELIUS_API_KEY
require_env HELIUS_WEBHOOK_SECRET

PROGRAM_ID="${SENTINEL_PROGRAM_ID:-${SENTINEL_REGISTRY_PROGRAM_ID:-}}"
if [[ -z "$PROGRAM_ID" ]]; then
  echo "[A2] missing env: SENTINEL_PROGRAM_ID (or SENTINEL_REGISTRY_PROGRAM_ID)"
  exit 1
fi

OWNER_ADDR="${SENTINEL_OWNER_PUBKEY:-UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ}"
WEBHOOK_ID="${HELIUS_WEBHOOK_ID:-}"
DB_PATH="${DATABASE_PATH:-app/.data/sentinel.db}"

mkdir -p .data
APP_LOG=".data/a2-app.log"
TUNNEL_LOG=".data/a2-tunnel.log"

echo "[A2] repo: $REPO_ROOT"
echo "[A2] db:   $DB_PATH"

if ! (ss -ltn 2>/dev/null || true) | awk '{print $4}' | rg -q '(:|^)3000$'; then
  echo "[A2] starting app dev server on :3000 (log: $APP_LOG)"
  nohup bash -lc "cd \"$REPO_ROOT\" && set -a && source ./.env && set +a && pnpm -F @sentinel/app dev" \
    >"$APP_LOG" 2>&1 &
else
  echo "[A2] app already listening on :3000 (reuse)"
fi

if ! pgrep -f "cloudflared tunnel --url http://localhost:3000" >/dev/null 2>&1; then
  echo "[A2] starting cloudflared tunnel (log: $TUNNEL_LOG)"
  nohup cloudflared tunnel --url http://localhost:3000 >"$TUNNEL_LOG" 2>&1 &
else
  echo "[A2] cloudflared already running (reuse)"
fi

echo "[A2] waiting for tunnel URL..."
for _ in {1..30}; do
  TUNNEL_URL_FOUND="$(rg -o "https://[a-z0-9-]+\\.trycloudflare\\.com" "$TUNNEL_LOG" | tail -n 1 || true)"
  if [[ -n "$TUNNEL_URL_FOUND" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${TUNNEL_URL_FOUND:-}" ]]; then
  echo "[A2] could not detect tunnel URL from $TUNNEL_LOG"
  echo "     inspect: rg \"trycloudflare.com|ERR|error\" .data/a2-tunnel.log"
  exit 1
fi

echo "[A2] tunnel: $TUNNEL_URL_FOUND"
TUNNEL_URL="$TUNNEL_URL_FOUND"

# Persist TUNNEL_URL for future probe scripts.
if [[ -f ".env" ]]; then
  if rg -q '^TUNNEL_URL=' .env; then
    python - <<'PY'
from pathlib import Path
p = Path(".env")
lines = p.read_text().splitlines()
tunnel = __import__("os").environ["TUNNEL_URL"]
out = []
for line in lines:
    if line.startswith("TUNNEL_URL="):
        out.append(f"TUNNEL_URL={tunnel}")
    else:
        out.append(line)
p.write_text("\n".join(out) + "\n")
PY
  else
    printf "\nTUNNEL_URL=%s\n" "$TUNNEL_URL" >> .env
  fi
fi

payload="$(cat <<EOF
{
  "webhookURL": "${TUNNEL_URL}/api/webhook",
  "transactionTypes": ["ANY"],
  "accountAddresses": ["${PROGRAM_ID}", "${OWNER_ADDR}"],
  "webhookType": "enhanced",
  "authHeader": "${HELIUS_WEBHOOK_SECRET}",
  "active": true
}
EOF
)"

call_helius() {
  local method="$1"
  local url="$2"
  curl -sS -X "$method" "$url" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

HELIUS_BASE="https://api-devnet.helius.xyz/v0/webhooks"
response=""

if [[ -n "$WEBHOOK_ID" ]]; then
  echo "[A2] updating existing webhook: $WEBHOOK_ID"
  response="$(call_helius PUT "${HELIUS_BASE}/${WEBHOOK_ID}?api-key=${HELIUS_API_KEY}")"
  if echo "$response" | rg -q '"error"'; then
    echo "[A2] update failed, falling back to create"
    response="$(call_helius POST "${HELIUS_BASE}?api-key=${HELIUS_API_KEY}")"
  fi
else
  echo "[A2] creating webhook (HELIUS_WEBHOOK_ID not set)"
  response="$(call_helius POST "${HELIUS_BASE}?api-key=${HELIUS_API_KEY}")"
fi

echo "$response" | jq .

NEW_ID="$(echo "$response" | jq -r '.webhookID // empty')"
if [[ -n "$NEW_ID" ]]; then
  echo "[A2] active webhook id: $NEW_ID"
  if [[ -f ".env" ]]; then
    if rg -q '^HELIUS_WEBHOOK_ID=' .env; then
      python - <<'PY'
from pathlib import Path
p = Path(".env")
lines = p.read_text().splitlines()
wid = __import__("os").environ["NEW_ID"]
out = []
for line in lines:
    if line.startswith("HELIUS_WEBHOOK_ID="):
        out.append(f"HELIUS_WEBHOOK_ID={wid}")
    else:
        out.append(line)
p.write_text("\n".join(out) + "\n")
PY
    else
      printf "HELIUS_WEBHOOK_ID=%s\n" "$NEW_ID" >> .env
    fi
  fi
else
  echo "[A2] warning: webhook response has no webhookID"
fi

echo "[A2] webhook endpoint health ping..."
health="$(curl --max-time 15 -sS -i \
  -X POST "${TUNNEL_URL}/api/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: ${HELIUS_WEBHOOK_SECRET}" \
  --data '[{"signature":"manual-a2-health","description":"register_policy agent: health"}]')"
printf "%s\n" "$health" | rg -n "HTTP/|\\{"

echo
echo "[A2] done."
echo "Next commands:"
echo "  pnpm fire:register-policy"
echo "  DATABASE_PATH=${DB_PATH} pnpm probe:check-webhook"
