# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repository is **pre-implementation**. The only file is `Plan.md`, an atomic, phase-by-phase build plan for Sentinel — a programmable transaction firewall for autonomous Solana agents. Code does not exist yet; the next agent's job is to execute `Plan.md` top-to-bottom.

`Plan.md` is the single source of truth for scope, schemas, verification criteria, and doc references. **Read it before starting any task.** Tasks are identified as `P<phase>.T<task>` (e.g. `P2.T3`) and each has explicit Goal / Steps / Verify / Docs / Common-failures sections — follow that structure rather than improvising.

## Execution discipline (from Plan.md)

- **Build → Verify → Move.** Do not start the next task until the current task's Verify step passes.
- If a verification fails twice, **re-read the linked doc** before changing more code.
- Run the Part D review checklist after **every phase** (tests green, devnet accounts exist, README + CHANGELOG updated, demo path works).
- A whole phase blocked > 1 day → escalate and descope; do not silently rewrite scope.

## Architecture (target system)

Sentinel sits between an agent's logic and the Solana network. Six components, split across off-chain (TypeScript) and on-chain (Rust/Anchor):

| Component | Layer | Responsibility |
|---|---|---|
| Policy DSL | off-chain (YAML + TS) | human rules → canonical JSON → 32-byte SHA-256 root |
| Registry program | on-chain (Anchor) | `(agent → policy_root, version, revoked)` PDA |
| Signer shim | off-chain (TS) | wraps a web3.js `Signer`; refuses to sign if local YAML root ≠ on-chain root |
| x402 interceptor | off-chain (Express/undici) | catches outgoing 402 challenges, runs them through the rule engine |
| Approval queue | off-chain (Next.js + SQLite/Postgres) | holds escalated txs awaiting human decision |
| Dashboard | off-chain (Next.js + Dune SIM) | live activity, policy editor, escalation modal |

**Trust model:** the shim runs co-located with the agent (no new trusted third party). The on-chain registry is the source of truth for *which policy is currently active*; the shim refuses to sign on root mismatch. The registry's update authority is the single most critical key.

**Rule precedence:** `Deny` > `Escalate` > `Allow`. Any rule denying → deny; otherwise any rule escalating → escalate.

## Locked tech decisions (do not substitute during MVP)

- **Rust** 1.78+, **Anchor** 0.30.1 (pin via `avm`), **Solana CLI** 1.18+
- **Node** 20+, **TypeScript** 5+, **pnpm** (monorepo)
- **`@solana/web3.js` ^1.95** — *not* `@solana/kit` (Anchor's TS client expects web3.js v1)
- **`@coral-xyz/anchor` ^0.30**
- **`yaml`** npm package (preferred over `js-yaml` for types)
- **`zod`** for runtime policy validation
- **Express ^4** for the x402 interceptor; **Next.js 14** (app router) for the dashboard
- **`better-sqlite3`** for rate-limit storage
- **Dune SIM** for analytics (Helius webhooks is the documented fallback)
- Hash everything with **SHA-256** (not keccak); pick one and stick with it.
- **Reject v0 (versioned) transactions** in the signer — explicitly out of MVP scope.

## Anti-scope (do not build)

Sentinel is not a wallet, not MPC, not a smart-contract auditor, not a relayer, and **not multi-chain in MVP** (Solana only). Cross-chain is post-hackathon.

## Submission deadline

Hackathon submission is **May 11, 2026 23:59 UTC**, with a 24-hour buffer. Today's date is in `Plan.md`'s context.

## Critical 48-hour verifications (Part F of Plan.md)

Before writing real code, confirm: (1) Zerion CLI signer is pluggable, (2) x402 Solana client is stable, (3) Dune SIM accepts our event shape, (4) Pyth pull oracle works on devnet, (5) Anchor 0.30 has no IDL bugs against the pinned Solana. If 1–3 fail, **stop and re-scope** before pushing through.

## Common-task commands (will exist once Phase 0 is done)

These don't work yet — they're listed so future agents know the *intended* surface once the workspace is initialized:

- Anchor program: `anchor build`, `anchor test`, `anchor deploy` (cluster set to Devnet in `Anchor.toml`)
- TS packages: `pnpm test` (vitest), `pnpm dev` (Next.js dashboard)
- Solana account inspection: `solana account <pda>`, `solana program show <program_id>`

When initializing the workspace, set `cluster = "Devnet"` in `Anchor.toml` and keep program IDs in `lib.rs` and `Anchor.toml` in sync after the first deploy.
