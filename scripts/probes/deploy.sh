#!/usr/bin/env bash
# A1: devnet deploy. Verifies airdrop, builds, deploys, captures program info.
# Run from repo root: bash scripts/probes/deploy.sh
set -euo pipefail

# Load repo .env if present so operators can keep config in one place.
if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

echo "[A1] checking solana cluster…"
CLUSTER=$(solana config get | awk '/RPC URL:/ {print $3}')
echo "    current cluster: $CLUSTER"
if [[ "$CLUSTER" != *"devnet"* ]]; then
  echo "[A1] switching to devnet"
  solana config set --url https://api.devnet.solana.com
fi

echo "[A1] balance check…"
BAL=$(solana balance --output json | jq -r '.lamports // 0')
NEEDED=2000000000  # 2 SOL
if (( BAL < NEEDED )); then
  echo "[A1] need >=2 SOL, have $((BAL/1000000000)) SOL — airdropping…"
  solana airdrop 2 || {
    echo "[A1] airdrop failed. Try faucet.solana.com manually then re-run."
    exit 1
  }
fi

echo "[A1] anchor build…"
anchor build

echo "[A1] anchor deploy --provider.cluster devnet…"
anchor deploy --provider.cluster devnet

PROGRAM_ID=$(solana address -k target/deploy/sentinel_registry-keypair.json)
echo "[A1] deployed program: $PROGRAM_ID"

echo "[A1] solana program show $PROGRAM_ID"
solana program show "$PROGRAM_ID"

echo ""
echo "[A1] DONE."
echo "Next:"
echo "  1. Confirm Anchor.toml [programs.devnet] entry matches: $PROGRAM_ID"
echo "  2. git add Anchor.toml programs/sentinel-registry/src/lib.rs"
echo "  3. git add target/idl/sentinel_registry.json target/types/sentinel_registry.ts"
echo "  4. git commit -m 'chore(P-A1): devnet deploy + commit IDL'"
echo "  5. Set SENTINEL_PROGRAM_ID=$PROGRAM_ID in your .env"
