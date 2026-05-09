# Sentinel

**Sentinel is a programmable policy primitive for Solana agent treasuries.** Pluggable YAML rules, on-chain root binding, plugs into Squads, Zerion, x402, and Helius. The signer-shim refuses to sign anything that violates the active policy; the active policy's hash lives on-chain as the only identity bind between local YAML and chain state. With a Squads multisig vault as the policy owner, every change requires threshold-many member approvals natively — Sentinel composes with existing governance instead of duplicating it.

> a16z's Christian Crowley framed the threat we address (["Agency by design", Dec 2025](https://a16zcrypto.com/posts/article/preserving-user-control-ai-agents)): "you might delegate an agent to manage staking rewards — only to find your funds rerouted to an obscure yield vault you've never heard of. You didn't sign that transaction — but you technically authorized it." The Solana Foundation's [Sep 2025 RFP](https://blog.colosseum.com/request-for-products) named trustless agent treasuries as an open primitive — Sentinel is one. (The off-chain rule layer plus on-chain root is what makes it composable across signing flows; the Squads-as-owner mode is what makes it composable across governance flows.)

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
| Signer shim (web3.js Signer, tx parser, Pyth Hermes oracle, root compare, sliding-window rate limit, Squads owner helpers) | off-chain | `packages/signer-shim/` |
| x402 interceptor (`createSentinelFetch`, Express `x402Protect` middleware, demo server/client) | off-chain | `packages/x402-interceptor/` |
| Zerion bridge (`sentinel.mjs` ESM file Zerion loads, `adaptCtx`) | off-chain | `packages/zerion-bridge/` |
| Dashboard (Next.js 14, Helius webhook receiver, SSE stream, escalation queue, Dune SIM balance proxy, Squads-multisig owner card) | off-chain | `app/` |

**Squads composition.** When a Sentinel `PolicyRecord.owner` is set to a Squads v4 vault PDA, the on-chain `has_one = owner` constraint resolves to threshold-many member approvals for every `update_policy`. The signer-shim exposes `buildSquadsBundle` / `buildSquadsExecuteTx` for the four-step flow (`vaultTransactionCreate` → `proposalCreate` → `proposalApprove` × threshold → `vaultTransactionExecute`). No on-chain code change required — see [`docs/squads-owner.md`](./docs/squads-owner.md).

Trust model: the shim runs co-located with the agent (no new trusted third party). The on-chain registry is the source of truth for *which policy is currently active*; the shim refuses to sign on root mismatch. The registry's `update_policy` authority is the single most critical key.

Rule precedence: `Deny > Escalate > Allow`. Any rule denying → deny; otherwise any rule escalating → escalate.

## What Sentinel is NOT

Not a wallet (we never custody keys). Not MPC (no Shamir/threshold/FHE — local rule eval + on-chain registry). Not a smart-contract auditor (we gate transaction *flow*, not Anchor program internals). Not a relayer (we sign locally). Not multi-chain in MVP (Solana only).

## Sponsor track addressability

See `docs/pitches/` for one paragraph per track.

| Track | Surface |
|---|---|
| Zerion #1 (scoped agents) | `packages/zerion-bridge/` — drop-in ESM policy script (real ctx captured 2026-05-02) |
| Zerion #2 (real txs) | `packages/x402-interceptor/` demo client runs real txs through `zerion-cli` |
| Dune SIM | `app/api/balance/` widget over `/svm/balances` |
| RPC Fast / Helius | `app/api/webhook/` ingests Helius enhanced txs for live policy events |
| Pyth | `packages/signer-shim/src/price-oracle.ts` — Hermes pull oracle for USD escalation thresholds |
| Squads (ecosystem) | `packages/signer-shim/src/squads-owner.ts` + dashboard "Squads multisig owner" card |
| 100xDevs | solo build, full SDK + dashboard |
| Adevar / Eitherway | pure infra primitive: policy DSL + on-chain root + Squads compose |
| Superteam India | regional builder track |

See [`docs/eligibility-check.md`](./docs/eligibility-check.md) for the per-track India-eligibility verification checklist.

## License

MIT.
