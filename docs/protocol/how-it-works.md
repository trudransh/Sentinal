# How Sentinel Works

## The Problem

Every Solana AI agent today holds a "god-mode" private key. The agent creates transactions, signs them, and broadcasts them — with nothing in between. If the agent is compromised, hallucinating, or its tools are hijacked, it can drain the wallet in a single block.

This isn't theoretical. As a16z's Christian Crowley wrote in ["Agency by design"](https://a16zcrypto.com/posts/article/preserving-user-control-ai-agents): *"you might delegate an agent to manage staking rewards — only to find your funds rerouted to an obscure yield vault you've never heard of."*

**Sentinel is the thing that sits between the agent and the network.**

---

## The Core Idea (30-second version)

```
Agent → creates a transaction
     → hands it to SentinelSigner (instead of a raw Keypair)
     → Sentinel checks:
         ✓ Does this tx violate any spending caps?
         ✓ Is the destination on the allowlist?
         ✓ Is the agent sending too many txs per minute?
         ✓ Does the USD value exceed the escalation threshold?
         ✓ Does my local policy match what's registered on-chain?
     → If everything passes → sign and return
     → If any rule fails → refuse to sign, log it, optionally escalate to a human
```

That's it. One line of code to swap your `Keypair` for a `SentinelSigner`, and your agent is policy-gated.

---

## The Three Layers

### 1. Policy DSL (off-chain rules)

You write your rules in YAML:

```yaml
version: 1
agent: 7BQ1jaQhFHxvsueak4n2ZygneHWkdVgVLovDS3U76QSA
caps:
  - token: USDC
    max_per_tx: 10       # max 10 USDC per single transaction
    max_per_day: 50      # max 50 USDC rolling 24-hour window
  - token: SOL
    max_per_tx: 0.5
allowlist:
  destinations:
    - DexRouter11111111111111111111111111111111111
rate_limit:
  max_tx_per_minute: 6
escalate_above:
  usd_value: 25          # anything above $25 goes to human approval
```

The DSL supports:
- **Spending caps** — per-token, per-tx and per-day limits
- **Allowlists** — only approved destination addresses can receive funds
- **Denylists** — explicitly blocked addresses
- **Program filters** — only approved programs can be invoked
- **Rate limits** — max transactions per minute
- **USD escalation thresholds** — anything above a dollar value gets held for human approval (priced via Pyth oracle)

**Rule precedence: Deny > Escalate > Allow.** If any rule denies, the tx is refused. If no deny but an escalate matches, it goes to the human queue. Otherwise, it's signed.

### 2. On-Chain Registry (source of truth)

The YAML is hashed (SHA-256 of RFC 8785 canonical JSON) to produce a 32-byte **policy root**. That root is stored on-chain in a Solana PDA:

```
PDA seeds: ["policy", agent_pubkey]
Fields:
  - owner: Pubkey       (who can update this policy)
  - policy_root: [u8; 32]  (SHA-256 of the canonical policy)
  - version: u64        (increments on each update)
  - revoked: bool       (if true, shim refuses ALL signing)
  - created_at: i64     (Unix timestamp)
```

Three instructions:
- `register_policy` — creates the PDA, sets the root
- `update_policy` — changes the root (only the owner can do this)
- `revoke_policy` — sets `revoked = true` (permanent kill switch)

**Why on-chain?** The signer-shim fetches the on-chain root before every signature. If someone tampers with the local YAML file, the hash won't match what's on-chain, and the shim refuses to sign. The chain is the single source of truth for "what policy is currently active."

### 3. Signer Shim (the enforcement layer)

`SentinelSigner` implements the `web3.js` `Signer` interface. It's a drop-in replacement for `Keypair`:

```typescript
// Before (no protection):
const tx = await connection.sendTransaction(myTx, [agentKeypair]);

// After (policy-gated):
const signer = new SentinelSigner({ policyPath: "./policy.yml", agentKeypair, ... });
const signedTx = await signer.signTransaction(myTx);
// If policy violated → throws SentinelPolicyViolation
// If on-chain root mismatch → throws SentinelRootMismatch
```

On every `signTransaction` call, the shim:
1. **Parses** the transaction instructions (identifies transfers, token movements, program calls)
2. **Evaluates** each rule in the local YAML against the parsed tx
3. **Checks Pyth** for current SOL/USD price (if USD thresholds are configured)
4. **Fetches** the on-chain PDA to compare roots
5. **Signs** if and only if everything passes

If a tx triggers `escalate_above`, it's held in a local SQLite queue and streamed to the dashboard via SSE for human approval.

---

## Architecture Diagram

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
```

---

## Trust Model (summary)

| Question | Answer |
|---|---|
| **Where does the shim run?** | Co-located with the agent. Same machine, same process. No new trusted third party. |
| **What if someone changes the local YAML?** | On-chain root comparison catches it. Hash mismatch → refuse to sign. |
| **What if the owner key is compromised?** | The owner can change the policy root. Use a hardware wallet or a Squads multisig as owner. |
| **What about versioned (v0) transactions?** | Rejected in MVP. The tx parser only handles legacy transactions. |
| **What if the RPC lies about the on-chain root?** | Partial defense — pin your RPC URL, monitor webhook events for unexpected changes. |

For the full threat model, see [`docs/TRUST_MODEL.md`](../TRUST_MODEL.md).

---

## Integrations

Sentinel composes with the existing Solana ecosystem rather than duplicating it:

| Integration | What it does |
|---|---|
| **Zerion** | Drop-in ESM policy script that Zerion's CLI loads dynamically. Every `zerion swap` goes through your Sentinel policy. |
| **x402** | Wraps `fetch` to intercept `402 Payment Required` responses. The payment-and-retry loop runs through policy evaluation. |
| **Helius** | Enhanced webhooks feed real-time transaction events to the dashboard's live activity stream. |
| **Pyth** | Hermes pull oracle provides SOL/USD prices for USD-denominated escalation thresholds. |
| **Squads** | Set a Squads vault PDA as the policy owner → every policy update requires threshold-many member approvals. |
| **Dune SIM** | Balance widget shows real token balances (mainnet via SIM, devnet via RPC fallback). |

---

## What Sentinel is NOT

- **Not a wallet.** Sentinel never custodies keys. Your agent keeps its own keypair.
- **Not MPC.** No Shamir, no threshold signatures, no FHE. Just local rule evaluation + on-chain root binding.
- **Not a smart contract auditor.** Sentinel gates transaction *flow*, not Anchor program internals.
- **Not a relayer.** Signing happens locally, in-process.
- **Not multi-chain (yet).** Solana only in v1.
