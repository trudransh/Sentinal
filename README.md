# Sentinel

**Programmable policy primitive for Solana agent treasuries.**

Sentinel sits between an autonomous agent's signing key and the Solana network. You define rules in YAML — spending caps per token, destination allowlists, rate limits, USD escalation thresholds — and Sentinel refuses to sign anything that violates them. The active policy's SHA-256 root lives on-chain; the local signer refuses to sign if what's on-chain disagrees with what's on disk. If a policy change needs multi-sig governance, you set the owner to a Squads vault PDA and the whole approval flow runs through Squads natively, with no changes to Sentinel itself.

The problem this solves: every Solana AI agent today holds a "god-mode" private key and trusts itself not to misbehave. A compromised agent, a hallucinating LLM, or a malicious tool call can drain the wallet because there's nothing in between the logic and the network. Sentinel is that something.

> a16z's Christian Crowley put it well in ["Agency by design" (Dec 2025)](https://a16zcrypto.com/posts/article/preserving-user-control-ai-agents): *"you might delegate an agent to manage staking rewards — only to find your funds rerouted to an obscure yield vault you've never heard of. You didn't sign that transaction — but you technically authorized it."*

---

## What's actually built

This isn't a prototype. Every integration has a real capture or a live probe behind it.

| Layer | What it does | Path |
|---|---|---|
| **Policy DSL** | YAML → canonical JSON (RFC 8785) → SHA-256 root. Pure TypeScript, no runtime deps beyond `zod` and `yaml`. | `packages/policy-dsl/` |
| **Registry program** | Anchor 0.32.1 program on Solana devnet. Stores `(agent → policy_root, version, revoked)` in a PDA. Three instructions: `register_policy`, `update_policy`, `revoke_policy`. | `programs/sentinel-registry/` |
| **Signer shim** | Wraps a `web3.js` Signer. Before every `signTransaction` / `signAllTransactions`, it parses the tx, evaluates it against the local policy, fetches the on-chain root, and refuses to sign if anything is wrong. Pyth Hermes pull oracle for USD thresholds. Rate-limiter backed by SQLite. | `packages/signer-shim/` |
| **Zerion bridge** | Drop-in ESM policy script (`sentinel.mjs`) that Zerion's CLI dispatcher loads via `dynamic import`. Adapts Zerion's runtime context shape (real ctx captured 2026-05-02) into Sentinel TxSummaries. Zerion swap blocked: `policy_denied`. | `packages/zerion-bridge/` |
| **x402 interceptor** | `createSentinelFetch` wraps `undici` fetch; `x402Protect` wraps an Express server. Handles the `402 Payment Required` → sign-and-retry loop with the same policy evaluation path. | `packages/x402-interceptor/` |
| **Dashboard** | Next.js 14 app. SSE-powered live activity feed (Helius enhanced webhooks). Escalation queue with on-chain `update_policy` signing via Phantom. Monaco YAML policy editor. Dune SIM balance widget. Agent spend chart. Squads multisig owner card. | `app/` |

**Tests: 111 total** — 105 vitest (unit + integration across all TS packages) + 6 Anchor mocha.

---

## Prerequisites

Install these before you clone. Version pinning matters for the Anchor/Solana toolchain.

```
Rust              1.82+   (via rustup)
Solana CLI        3.0.13  (Agave edition)
Anchor CLI        0.32.1  (via `avm use 0.32.1`)
Node.js           20+
pnpm              10.x    (npm install -g pnpm)
```

**Rust + Solana:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
solana --version  # should say agave-3.x
```

**Anchor:**
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1
avm use 0.32.1
anchor --version  # should say anchor-cli 0.32.1
```

**Node + pnpm:**
```bash
# via nvm (recommended)
nvm install 20
nvm use 20
npm install -g pnpm@10
```

---

## Installation

```bash
git clone <this-repo> sentinel
cd sentinel
pnpm install          # installs all workspace packages
pnpm -r build         # compiles all TypeScript packages to dist/
anchor build          # compiles the Rust program (takes ~2 min first time)
```

After `anchor build`, you'll find:
- `target/idl/sentinel_registry.json` — the Anchor IDL
- `target/types/sentinel_registry.ts` — TypeScript types
- `target/deploy/sentinel_registry.so` — compiled program

---

## Configuration

Copy the example env file and fill in the required values:

```bash
cp .env.example .env
```

### Minimum for local dev (no real keys needed)

```bash
# .env — minimal local dev config

SOLANA_RPC_URL=https://api.devnet.solana.com
SENTINEL_REGISTRY_PROGRAM_ID=2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk
NEXT_PUBLIC_SENTINEL_REGISTRY_PROGRAM_ID=2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk
NEXT_PUBLIC_DEMO_AGENT=AGENTPubKEy11111111111111111111111111111111

# Skip auth checks in local dev
SENTINEL_ALLOW_UNAUTH_WEBHOOK=1
SENTINEL_ALLOW_UNAUTH_DASHBOARD=1
SENTINEL_DASHBOARD_TOKEN=local-dev-token
```

### Full env reference

| Variable | Required | Description |
|---|---|---|
| `SOLANA_RPC_URL` | Optional | RPC endpoint. Defaults to `https://api.devnet.solana.com`. Use a Helius/QuickNode RPC for higher rate-limits. |
| `SENTINEL_REGISTRY_PROGRAM_ID` | Required | On-chain program ID. Pre-deployed on devnet: `2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk`. |
| `NEXT_PUBLIC_SENTINEL_REGISTRY_PROGRAM_ID` | Required | Same value — exposed to the browser bundle. |
| `NEXT_PUBLIC_DEMO_AGENT` | Optional | Agent pubkey the dashboard displays. Defaults to a placeholder. |
| `SENTINEL_DASHBOARD_TOKEN` | Required in prod | Auth token for escalation/policy actions. Generate: `openssl rand -hex 32`. Leave blank for local dev + set `SENTINEL_ALLOW_UNAUTH_DASHBOARD=1`. |
| `HELIUS_API_KEY` | Required for live feed | Get free at [dev.helius.xyz](https://dev.helius.xyz/dashboard). Powers the webhook ingestion route. |
| `HELIUS_WEBHOOK_SECRET` | Required in prod | Any random string. Paste the same value into Helius dashboard → Webhook Secret. Validated with `crypto.timingSafeEqual`. |
| `SENTINEL_ALLOW_UNAUTH_WEBHOOK` | Dev only | Set to `1` to skip webhook auth. Never in production. |
| `SENTINEL_ALLOW_UNAUTH_DASHBOARD` | Dev only | Set to `1` to skip dashboard token check. |
| `SIM_API_KEY` | Optional | [Dune SIM](https://dune.com/sim) key. Balance widget degrades gracefully if unset. |
| `DATABASE_PATH` | Optional | SQLite file path. Defaults to `app/.data/sentinel.db`. |
| `X402_RECEIVING_ADDRESS` | x402 demo | Solana pubkey that receives x402 payments in the demo server. |
| `X402_BLOCKED_ADDRESS` | x402 demo | Address the demo server rejects (to trigger the `payment-required` flow). |
| `DEMO_PORT` | x402 demo | Port for the x402 demo server. Defaults to `3100`. |
| `AUTO_APPROVE` | Testing only | Set to `1` to auto-approve all escalations. Never in production. |

---

## Running the dashboard

```bash
# Start the Next.js dev server
pnpm -F @sentinel/app dev
# Open http://localhost:3000
```

For a production build:
```bash
pnpm -F @sentinel/app build
pnpm -F @sentinel/app start
```

What you'll see:
- **Sidebar nav** — Dashboard / Policies / Activity / Settings, wallet connect pill, devnet badge
- **Wallet balance** — token grid (real balances via Dune SIM, devnet RPC fallback)
- **Agent spend chart** — 7-day gradient chart with hover tooltips
- **Live activity feed** — SSE stream from Helius webhooks; events slide in as they arrive
- **Escalation queue** — pending approvals with urgency badges, two-step confirm
- **Policy editor** — Monaco YAML editor with validate-and-hash toolbar
- **Squads multisig owner** — paste a multisig PDA, see members/threshold, propose policy updates via Squads

---

## Running tests

```bash
pnpm test             # all vitest suites (105 tests across 5 packages)
pnpm -r typecheck     # TypeScript across all packages
anchor test           # 6 Anchor mocha tests against localnet
pnpm verify           # typecheck + all tests (use before committing)
```

---

## Deploying the program

The program is **already deployed on Solana devnet** at `2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk`. You don't need to redeploy to run probes or the dashboard.

To redeploy (e.g. if you fork and modify the program):

```bash
solana config set --url devnet
solana airdrop 4   # you need ~2 SOL for deployment

anchor build
anchor deploy --provider.cluster devnet

# Update Anchor.toml + programs/sentinel-registry/src/lib.rs with the new ID
# Then rebuild:
anchor build
pnpm -r build
```

---

## Probe scripts

These scripts verify each live integration. Run them individually after setting the relevant env vars. All output is written to `/tmp/sentinel-*.json` for inspection.

### `pnpm probe:squads`
**Tests the Squads v4 SDK adapter offline** — derives PDAs, builds the four-step bundle (create/propose/approve/execute), verifies the inner `update_policy` instruction encoding. No network required.
```bash
pnpm probe:squads
# Output: /tmp/sentinel-squads-probe.json
```

### `pnpm probe:pyth`
**Verifies Pyth Hermes pull oracle** — fetches a real SOL/USD price feed from `hermes.pyth.network`. Confirms the price oracle path the signer-shim uses for USD escalation thresholds.
```bash
pnpm probe:pyth
```

### `pnpm probe:helius`
**Verifies Helius RPC connectivity** — lists recent transactions for the demo agent address using `HELIUS_API_KEY`.
```bash
HELIUS_API_KEY=your-key pnpm probe:helius
```

### `pnpm probe:sim`
**Verifies Dune SIM balance endpoint** — hits `/beta/svm/balances` for the agent address. Note: SIM only indexes mainnet, so devnet wallets return empty (that's expected and documented).
```bash
SIM_API_KEY=your-key AGENT_ADDRESS=your-pubkey pnpm probe:sim
# Output: /tmp/sentinel-sim-response.json
```

### `pnpm probe:check-webhook`
**Fires a test webhook payload** at your local dashboard to verify the `HELIUS_WEBHOOK_SECRET` validation and SQLite write path. The dashboard must be running.
```bash
# In one terminal: pnpm -F @sentinel/app dev
# In another:
HELIUS_WEBHOOK_SECRET=your-secret pnpm probe:check-webhook
```

### `pnpm probe:x402-live`
**Runs the x402 payment flow end-to-end** — starts the demo server and client, executes a real `402 → sign → retry` payment cycle on devnet. Requires a funded devnet keypair.
```bash
X402_RECEIVING_ADDRESS=... pnpm probe:x402-live
```

### `pnpm probe:zerion`
**Captures a real Zerion CLI policy context** — monkey-patches the global `deny-transfers.mjs` policy, fires a Zerion sign-message command, captures the runtime ctx shape, then restores. Requires `zerion-cli` installed globally.
```bash
# Install zerion-cli first (one-time):
npm install -g zerion-cli

pnpm probe:zerion
# Captured context: /tmp/sentinel-zerion-ctx.json
# Evidence: /tmp/sentinel-a5-evidence.txt
```

### `pnpm probe:zerion:swap-global`
**Captures a Zerion swap pre-assembly context** — fires a USDC→ETH swap, captures the stub ctx (`data: "0x"`, `to: null`) that Zerion sends before assembling calldata. Demonstrates the bridge correctly denies on empty stubs.
```bash
pnpm probe:zerion:swap-global
# Captured context: /tmp/sentinel-zerion-ctx-swap.json
```

### `pnpm seed`
**Seeds the dashboard database with demo data** — inserts sample policy events and escalations so the dashboard has something to display on a fresh install.
```bash
pnpm -F @sentinel/app dev &   # dashboard must be running
pnpm seed
```

### `pnpm fire:register-policy`
**Registers a real policy on devnet** — takes the demo keypair, hashes `examples/policies/medium.yml`, and calls `register_policy` on the deployed program.
```bash
pnpm fire:register-policy
```

---

## Using the signer shim in your own agent

```bash
pnpm add @sentinel/signer-shim @sentinel/policy-dsl
```

```typescript
import { SentinelSigner } from "@sentinel/signer-shim";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { Keypair, Connection } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

// 1. Load your agent keypair
const agentKeypair = Keypair.fromSecretKey(/* your secret key bytes */);
const connection = new Connection("https://api.devnet.solana.com");

// 2. Wrap it with Sentinel
const signer = new SentinelSigner({
  policyPath: "./policy.yml",         // path to your YAML policy file
  agentKeypair,
  registryProgramId: new PublicKey("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk"),
  rpcUrl: "https://api.devnet.solana.com",
  fetchAccount: async (pda) => {
    // fetch the on-chain PolicyRecord via your Anchor program client
    return program.account.policyRecord.fetch(pda);
  },
});

// 3. Use it everywhere you'd use a normal Keypair — it's a drop-in Signer
const tx = await signer.signTransaction(myTransaction);
// If the tx violates policy: throws SentinelPolicyViolation
// If the on-chain root doesn't match your local YAML: throws SentinelRootMismatch
```

### Example policy file

```yaml
version: 1
agent: <your-agent-pubkey>
caps:
  - token: USDC
    max_per_tx: 10        # max USDC per transaction
    max_per_day: 50       # max USDC per day (rolling 24h)
  - token: SOL
    max_per_tx: 0.5
allowlist:
  destinations:           # only these addresses can receive funds
    - DexRouter1111111111111111111111111111111111
rate_limit:
  max_tx_per_minute: 6
```

Rule precedence: **Deny > Escalate > Allow**. Any matching Deny rule → refuse to sign. No Deny but a matching Escalate → hold in queue for human approval. All Allow or no match → sign.

---

## Zerion integration

Sentinel ships a drop-in ESM policy script that Zerion's CLI loads dynamically:

```bash
# Install the bridge
npm install -g @sentinel/zerion-bridge

# Point Zerion at your Sentinel policy
zerion config set policy-script "$(node -e "require.resolve('@sentinel/zerion-bridge/sentinel.mjs')")"

# From now on, every zerion swap/send/sign goes through your policy
zerion swap USDC ETH 5 --chain base
# If it violates policy: {"code":"policy_denied","message":"Blocked by policy"}
```

The bridge adapts Zerion's runtime context (`chain_id` is CAIP-2 at the top level, `transaction.data` is `"0x"` for swap pre-assembly) into Sentinel's `TxSummary` format. Non-Solana chains return `null` (defer to Zerion's built-in EVM rules). The real captured ctx shape is in `packages/zerion-bridge/src/adapter.test.ts`.

---

## Squads multisig as policy owner

By default, the policy owner is a single keypair. For production governance, you can make a Squads vault PDA the owner — every `update_policy` then requires threshold-many member approvals.

```typescript
import {
  buildRegisterPolicyViaSquads,
  buildSquadsExecuteTx,
  fetchMultisigSnapshot,
  getSentinelVaultPda,
} from "@sentinel/signer-shim/squads-owner";

// 1. Get the vault PDA that will be the policy owner
const snapshot = await fetchMultisigSnapshot(connection, multisigPda);
console.log("policy owner will be:", snapshot.vaultPda.toBase58());

// 2. Register the policy via Squads (vault signs as owner)
const { createTx, proposeTx, approveTxs, transactionIndex } =
  await buildRegisterPolicyViaSquads({
    connection, registryProgramId, multisigPda, agent, root,
    creator: member1, approvers: [member1],
  });

// 3. Broadcast in order
await sendAndConfirm(createTx, [member1]);
await sendAndConfirm(proposeTx, [member1]);
for (const approveTx of approveTxs) await sendAndConfirm(approveTx, [member1]);

// 4. After threshold approvals, execute:
const executeTx = await buildSquadsExecuteTx({ connection, multisigPda, transactionIndex, executor: member1 });
await sendAndConfirm(executeTx, [member1]);
```

The dashboard's **Squads multisig owner** card does all of this through Phantom — paste a multisig PDA, see the members, propose and execute.

---

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │         Agent logic (any LLM)       │
                    └──────────────┬──────────────────────┘
                                   │ creates tx
                    ┌──────────────▼──────────────────────┐
                    │         SentinelSigner (shim)       │
                    │  1. parse tx instructions           │
                    │  2. evaluate against local YAML     │
                    │  3. check Pyth USD price            │
                    │  4. fetch on-chain root (PDA)       │
                    │  5. compare local root == on-chain  │
                    │  6. sign iff everything passes      │
                    └──────┬───────────────────┬──────────┘
                           │ passes            │ fails
               ┌───────────▼────┐    ┌─────────▼─────────┐
               │  Solana network│    │  escalation queue │
               └────────────────┘    │ (SQLite → SSE →   │
                                     │   dashboard →     │
                                     │   human approve)  │
                                     └───────────────────┘

                    ┌─────────────────────────────────────┐
                    │       Sentinel Registry (Anchor)    │
                    │  PDA: [policy, agent_pubkey]        │
                    │  Fields: owner, root, version,      │
                    │          revoked, created_at        │
                    │  Events: PolicyRegistered,          │
                    │          PolicyUpdated, Revoked     │
                    └──────────────┬──────────────────────┘
                                   │ on-chain root
                    ┌──────────────▼──────────────────────┐
                    │     Squads (optional governance)    │
                    │  vault PDA as owner → threshold     │
                    │  approvals for update_policy        │
                    └─────────────────────────────────────┘
```

**Trust model**: the shim runs co-located with the agent — no new trusted third party. The on-chain PDA is the single source of truth for which policy is active. The registry owner key (or Squads vault) is the only key that can change it. See `docs/TRUST_MODEL.md` for the full threat model.

---

## Sponsor track surface

| Track | Integration |
|---|---|
| **Zerion #1** (scoped agent policies) | `packages/zerion-bridge/` — real ctx captured 2026-05-02, swap denied live |
| **Zerion #2** (real transactions) | `packages/x402-interceptor/` — x402 interceptor runs real devnet txs through `zerion-cli` |
| **Helius / RPC Fast** | `app/api/webhook/` — live Helius enhanced webhook subscription, decoded events in live feed |
| **Dune SIM** | `app/api/balance/` — `/beta/svm/balances` proxy, token grid, sparklines |
| **Pyth** | `packages/signer-shim/src/price-oracle.ts` — Hermes pull oracle, real SOL/USD price for USD caps |
| **Squads** | `packages/signer-shim/src/squads-owner.ts` + dashboard card — vault PDA as policy owner, threshold governance |
| **Adevar / Eitherway** | Whole project: open-source policy primitive, MIT licensed, composable |
| **100xDevs** | Solo build, full SDK + dashboard, public GitHub |
| **Superteam India** | Regional track — India resident builder |

---

## Project structure

```
sentinel/
├── programs/
│   └── sentinel-registry/src/lib.rs   Anchor program (register / update / revoke)
├── packages/
│   ├── policy-dsl/        YAML schema, canonicalizer, rule engine, SHA-256 root
│   ├── signer-shim/       SentinelSigner, tx parser, Pyth oracle, Squads builder
│   ├── zerion-bridge/     sentinel.mjs, ZerionCtx adapter
│   └── x402-interceptor/  createSentinelFetch, x402Protect middleware
├── app/                   Next.js 14 dashboard
│   ├── app/api/           webhook, stream (SSE), escalations, policy, balance, agent-spend
│   ├── app/components/    AppShell, LiveActivity, EscalationQueue, PolicyEditor,
│   │                      BalanceWidget, AgentSpendChart, SquadsConnect, ...
│   └── lib/               db.ts, helius.ts, balance.ts, spend.ts, rpc.ts, sim.ts
├── scripts/
│   ├── seed-demo.ts       Seeds dashboard with demo events + escalations
│   ├── probes/
│   │   ├── squads-probe.ts      Offline Squads SDK decision-gate probe
│   │   ├── pyth.ts              Pyth Hermes live price fetch
│   │   ├── helius.ts            Helius RPC connectivity check
│   │   ├── sim.ts               Dune SIM balance endpoint check
│   │   ├── check-webhook.ts     Local webhook payload test
│   │   ├── x402-live.ts         End-to-end x402 payment demo
│   │   ├── zerion-capture-ctx.sh  Real Zerion ctx capture
│   │   ├── zerion-restore.sh      Restore patched zerion files
│   │   ├── fire-register-policy.ts  Register a policy on devnet
│   │   ├── deploy.sh              Anchor deploy + IDL upload helper
│   │   ├── balance-spend.ts       Fetch balance + spend in one pass
│   │   └── load-env.ts            Shared .env loader for probe scripts
│   └── zerion.mjs         Zerion policy script stub for manual testing
├── examples/
│   ├── policies/          small.yml, medium.yml, strict.yml  ← start here
│   └── embed/             standalone policy-dsl usage example
├── tests/
│   └── sentinel-registry.ts  Anchor mocha test suite (6 tests)
├── docs/
│   ├── TRUST_MODEL.md         Full threat model + key compromise scenarios
│   ├── squads-owner.md        Squads multisig governance deep-dive
│   ├── adr/                   Architecture Decision Records
│   └── architecture/          Domain diagrams
├── Anchor.toml
├── Cargo.toml
└── pnpm-workspace.yaml
```

---

## Verification checklist (for judges and self-review)

Run these in order on a fresh clone to verify everything works end-to-end:

```bash
# 1. Install + build
pnpm install && pnpm -r build && anchor build
echo "✓ build"

# 2. All tests pass
pnpm verify
echo "✓ 111 tests (105 vitest + 6 anchor)"

# 3. Production build compiles
pnpm -F @sentinel/app build
echo "✓ Next.js build"

# 4. Squads SDK probe (offline, no keys needed)
pnpm probe:squads
cat /tmp/sentinel-squads-probe.json | grep '"decision"'
echo "✓ Squads adapter"

# 5. Dashboard starts and serves
pnpm -F @sentinel/app dev &
sleep 3
curl -s http://localhost:3000 | grep -q "Sentinel" && echo "✓ dashboard up"

# 6. Seed demo data
pnpm seed
echo "✓ demo data seeded"

# 7. API routes respond
curl -s http://localhost:3000/api/escalations | grep -q "escalations"
curl -s "http://localhost:3000/api/balance?address=AGENTPubKEy11111111111111111111111111111111" | grep -q "_source"
echo "✓ API routes"

# 8. Policy validate route
curl -s -X POST http://localhost:3000/api/policy \
  -H "Content-Type: application/json" \
  -d '{"yaml":"version: 1\nagent: AGENTPubKEy11111111111111111111111111111111\n"}' \
  | grep -q "rootHex"
echo "✓ policy validation"

# Live integrations (require API keys — see .env.example):
# HELIUS_API_KEY=xxx pnpm probe:helius
# SIM_API_KEY=xxx AGENT_ADDRESS=xxx pnpm probe:sim
# pnpm probe:pyth   (no key needed — uses public Hermes endpoint)
```

---

## License

MIT — see `LICENSE`. This is an open primitive; fork it, build on it, make agents safer.

---

*Built for the Solana Frontier hackathon (deadline May 11, 2026). Solo build, 17 days. India.*
