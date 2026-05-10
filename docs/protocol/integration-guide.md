# Integration Guide

> **Time to integrate: ~10 minutes.** This guide takes you from zero to a policy-gated Solana agent.

---

## Prerequisites

- Node.js 20+
- A Solana agent that uses `@solana/web3.js` for signing
- A devnet-funded keypair for the agent

---

## Step 1: Install

```bash
npm install @sentinel/signer-shim @sentinel/policy-dsl
# or
pnpm add @sentinel/signer-shim @sentinel/policy-dsl
```

---

## Step 2: Write a Policy

Create a file called `policy.yml` in your project root:

```yaml
version: 1
agent: <your-agent-pubkey>

# Spending caps
caps:
  - token: SOL
    max_per_tx: 1.0       # max 1 SOL per transaction
    max_per_day: 10.0     # max 10 SOL per rolling 24 hours
  - token: USDC
    max_per_tx: 25
    max_per_day: 100

# Only these addresses can receive funds
allowlist:
  destinations:
    - <your-treasury-pubkey>
    - <your-dex-router-pubkey>

# Rate limiting
rate_limit:
  max_tx_per_minute: 10

# Anything above $50 USD goes to human approval queue
escalate_above:
  usd_value: 50
```

Replace `<your-agent-pubkey>` with the base58 public key of your agent's keypair.

---

## Step 3: Register the Policy On-Chain

```typescript
import { policyRootHex } from "@sentinel/policy-dsl";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// Parse and hash the policy
const yaml = readFileSync("./policy.yml", "utf8");
const root = policyRootHex(parse(yaml));
console.log("Policy root:", root);

// Register on-chain (one-time setup)
// Use the Anchor client or the dashboard to call `register_policy`
// with your agent pubkey and the root hash.
```

You can also register via the dashboard UI:
1. Open `http://localhost:3000`
2. Go to the Policy Editor
3. Paste your YAML
4. Click "validate" → shows the root hash
5. Sign with Phantom to register on-chain

---

## Step 4: Wrap Your Agent's Signer

This is the one line that makes your agent policy-gated:

```typescript
import { SentinelSigner } from "@sentinel/signer-shim";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";

// Your existing agent keypair
const agentKeypair = Keypair.fromSecretKey(/* your secret key bytes */);
const connection = new Connection("https://api.devnet.solana.com");

// Wrap it with Sentinel
const signer = new SentinelSigner({
  policyPath: "./policy.yml",
  agentKeypair,
  registryProgramId: new PublicKey("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk"),
  rpcUrl: "https://api.devnet.solana.com",
  fetchAccount: async (pda) => {
    // Fetch the on-chain PolicyRecord
    // Option A: via Anchor
    return program.account.policyRecord.fetch(pda);
    // Option B: raw account data (if you don't use Anchor)
    // const info = await connection.getAccountInfo(pda);
    // return deserializePolicyRecord(info.data);
  },
});

// Use `signer` everywhere you used `agentKeypair`
// It's a drop-in web3.js Signer
```

---

## Step 5: Handle Policy Violations

The shim throws typed errors you can catch:

```typescript
import { SentinelPolicyViolation, SentinelRootMismatch } from "@sentinel/signer-shim";

try {
  const signedTx = await signer.signTransaction(tx);
  await connection.sendRawTransaction(signedTx.serialize());
} catch (err) {
  if (err instanceof SentinelPolicyViolation) {
    console.log("Policy violation:", err.rule, err.message);
    // e.g. "CAP_EXCEEDED: USDC transfer of 100 exceeds max_per_tx of 25"
    //      "DESTINATION_NOT_ALLOWED: recipient not in allowlist"
    //      "RATE_LIMIT: 11 txs in last minute exceeds limit of 10"
  }
  if (err instanceof SentinelRootMismatch) {
    console.log("Policy tampered! Local root doesn't match on-chain.");
    // Someone changed your policy.yml without updating on-chain.
    // Or someone updated on-chain without updating your local file.
  }
}
```

---

## Step 6 (Optional): Run the Dashboard

The dashboard gives you a real-time view of your agent's activity:

```bash
# Clone the Sentinel repo
git clone <repo> sentinel && cd sentinel
pnpm install && pnpm -r build

# Configure
cp .env.example .env
# Edit .env with your agent pubkey, Helius API key, etc.

# Run
pnpm -F @sentinel/app dev
# Open http://localhost:3000
```

Dashboard features:
- **Live activity feed** — SSE stream of Helius webhook events
- **Escalation queue** — pending human approvals with urgency badges
- **Policy editor** — Monaco YAML editor with validate-and-hash
- **Balance widget** — real-time token balances
- **Spend chart** — 7-day transaction volume graph
- **Squads multisig card** — governance status and proposal flow

---

## Step 7 (Optional): Squads Multisig Governance

For production deployments, make a Squads multisig the policy owner:

```typescript
import {
  buildRegisterPolicyViaSquads,
  buildSquadsExecuteTx,
  getSentinelVaultPda,
} from "@sentinel/signer-shim/squads-owner";

// The vault PDA becomes the policy owner
const vaultPda = getSentinelVaultPda(multisigPda);

// Now every policy update requires threshold-many member approvals
// through Squads native governance
```

See [`docs/squads-owner.md`](../squads-owner.md) for the full flow.

---

## Common Patterns

### AI Trading Agent
```yaml
version: 1
agent: <trading-bot-pubkey>
caps:
  - token: USDC
    max_per_tx: 100
    max_per_day: 500
  - token: SOL
    max_per_tx: 2
allowlist:
  destinations:
    - <jupiter-program>
    - <raydium-program>
programs:
  allow:
    - JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4   # Jupiter
    - 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8  # Raydium
rate_limit:
  max_tx_per_minute: 30
```

### DeFi Yield Agent
```yaml
version: 1
agent: <yield-agent-pubkey>
caps:
  - token: USDC
    max_per_tx: 1000
    max_per_day: 5000
allowlist:
  destinations:
    - <marinade-program>
    - <solend-program>
escalate_above:
  usd_value: 500        # human approval above $500
rate_limit:
  max_tx_per_minute: 5
```

### Payment Processing Agent
```yaml
version: 1
agent: <payments-agent-pubkey>
caps:
  - token: USDC
    max_per_tx: 50
    max_per_day: 1000
  - token: SOL
    max_per_day: 0.01    # only for tx fees
allowlist:
  destinations:
    - <merchant-1-pubkey>
    - <merchant-2-pubkey>
    - <merchant-3-pubkey>
rate_limit:
  max_tx_per_minute: 20
escalate_above:
  usd_value: 25
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SentinelRootMismatch` | Local YAML changed without updating on-chain (or vice versa) | Re-register the policy via `update_policy` or revert the YAML |
| `CAP_EXCEEDED` | Transaction amount exceeds `max_per_tx` or rolling `max_per_day` | Raise the cap in your policy, or split into smaller transactions |
| `RATE_LIMIT` | Too many transactions in the sliding window | Reduce transaction frequency, or raise `max_tx_per_minute` |
| `DESTINATION_NOT_ALLOWED` | Recipient not in `allowlist.destinations` | Add the address to your allowlist |
| `POLICY_REVOKED` | On-chain policy has `revoked = true` | Register a new policy (revocation is permanent per-PDA) |
| Balance widget shows "Invalid public key" | `NEXT_PUBLIC_DEMO_AGENT` is set to a fake/placeholder key | Set it to a real devnet-funded Solana address |
