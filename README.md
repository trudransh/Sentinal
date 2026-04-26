# Sentinel

**Sentinel is a programmable transaction firewall for autonomous Solana agents.** It enforces scoped spending, allowlists, rate limits, and human-in-the-loop approvals between an agent's logic and the chain. A compromised or hallucinating agent can never empty a wallet or sign an out-of-policy transaction — regardless of what its signing key tries to do — because the rule layer runs locally before signing, and the active policy's hash lives on-chain as the only identity bind between local YAML and chain state.

## Why

Today every Solana agent (Zerion CLI bots, x402 paying clients, AI trading scripts) holds a "god-mode" private key and trusts itself not to misbehave. Sentinel inserts a thin policy layer that runs *between* the agent's signer and the network:

- write rules in YAML (caps per token/day/hour, allowlists, denylists, program filters, USD escalation thresholds, per-minute rate limits);
- the rule engine canonicalizes the YAML and hashes it to a 32-byte root;
- that root lives on-chain in the registry program; the signer-shim refuses to sign if local YAML and on-chain root disagree;
- escalations route through a Next.js dashboard for human approval.

## 5-second install

```bash
git clone <this-repo> sentinel
cd sentinel
pnpm install
pnpm -r build
anchor build
```

You'll need: Rust 1.93, Anchor 0.32.1, Solana CLI Agave 3.0+, Node 20+, pnpm 10+.

## 60-second quickstart

1. **Write a policy** in `examples/policies/medium.yml`:
   ```yaml
   version: 1
   agent: <your-agent-pubkey>
   caps:
     - token: USDC
       max_per_tx: 10
       max_per_day: 50
   allowlist:
     destinations: [<treasury-pubkey>]
   rate_limit:
     max_tx_per_minute: 6
   ```

2. **Compute the root** locally:
   ```ts
   import { policyRootHex } from "@sentinel/policy-dsl";
   import { parse } from "yaml";
   import { readFileSync } from "node:fs";
   const root = policyRootHex(parse(readFileSync("policy.yml", "utf8")));
   ```

3. **Register it** on-chain via the Anchor client (one `register_policy` ix).

4. **Wrap your agent's signer**:
   ```ts
   import { SentinelSigner } from "@sentinel/signer-shim";
   const signer = new SentinelSigner({
     policyPath: "./policy.yml",
     agentKeypair,
     registryProgramId,
     rpcUrl: "https://api.devnet.solana.com",
     fetchAccount: async (pda) => /* anchor program.account.policyRecord.fetch(pda) */,
   });
   ```

5. **Run the dashboard** in another terminal:
   ```bash
   pnpm -F @sentinel/app dev
   ```

   Open http://localhost:3000 — live activity, policy editor (Monaco YAML), escalation queue, balance widget.

## Architecture

| Component | Layer | Path |
|---|---|---|
| Policy DSL (zod schema, RFC 8785 canonicalizer, pure-function rule engine) | off-chain | `packages/policy-dsl/` |
| Registry program (PDA per agent, `register`/`update`/`revoke`, events) | on-chain | `programs/sentinel-registry/` |
| Signer shim (web3.js Signer, tx parser, Pyth Hermes oracle, root compare, sliding-window rate limit) | off-chain | `packages/signer-shim/` |
| x402 interceptor (`createSentinelFetch`, Express `x402Protect` middleware, demo server/client) | off-chain | `packages/x402-interceptor/` |
| Zerion bridge (`sentinel.mjs` ESM file Zerion loads, `adaptCtx`) | off-chain | `packages/zerion-bridge/` |
| Dashboard (Next.js 14, Helius webhook receiver, SSE stream, escalation queue, Dune SIM balance proxy) | off-chain | `app/` |

Trust model: the shim runs co-located with the agent (no new trusted third party). The on-chain registry is the source of truth for *which policy is currently active*; the shim refuses to sign on root mismatch. The registry's `update_policy` authority is the single most critical key.

Rule precedence: `Deny > Escalate > Allow`. Any rule denying → deny; otherwise any rule escalating → escalate.

## What Sentinel is NOT

Not a wallet (we never custody keys). Not MPC (no Shamir/threshold/FHE — local rule eval + on-chain registry). Not a smart-contract auditor (we gate transaction *flow*, not Anchor program internals). Not a relayer (we sign locally). Not multi-chain in MVP (Solana only).

## Sponsor track addressability

See `docs/pitches/` for one paragraph per track.

| Track | Surface |
|---|---|
| Zerion #1 (scoped agents) | `packages/zerion-bridge/` — drop-in ESM policy script |
| Zerion #2 (real txs) | `packages/x402-interceptor/` demo client runs real txs through `zerion-cli` |
| Dune SIM | `app/api/balance/` widget over `/svm/balances` |
| RPC Fast / Helius | `app/api/webhook/` ingests Helius enhanced txs for live policy events |
| 100xDevs | solo build, full SDK + dashboard, 17 days |
| Adevar/Eitherway | pure infra primitive: agent transaction firewall |
| Superteam India | regional builder track |

## License

MIT.
