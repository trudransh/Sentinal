# Sentinel — MVP Build Plan

> **Audience:** another agent (or a developer working with one) executing this plan top-to-bottom over 14–17 working days.
> **Style:** every task is atomic — a single, verifiable unit of work with explicit inputs, outputs, verification, doc references, and common failure modes.
> **Discipline:** *Build → Verify → Move.* Do not start the next task until the current task's verification passes. If it fails twice, stop and re-read the doc reference before improvising.

---

## Part A — The Picture: what we are building

### One-liner
**Sentinel is a programmable transaction firewall for autonomous Solana agents.** It enforces scoped spending, allowlists, rate limits, and human-in-the-loop approvals between an agent's logic and the chain — so a compromised or hallucinating agent can never empty a wallet or sign an out-of-policy transaction.

### Three-line elevator
Today, every Solana agent (Zerion CLI bots, x402 paying clients, AI trading scripts) holds a "god-mode" private key and trusts itself not to misbehave. Sentinel inserts a policy layer that runs *between* the agent's signer and the network: every outbound instruction is matched against a YAML-defined policy whose hash lives on-chain. Agents become safe to deploy unattended, and humans get a single, revocable on-chain switch when they need to pull the plug.

### Concrete personas

**P1 — Solo trading-bot dev.** Has a Solana bot that auto-rebalances a portfolio. Wants the bot to never touch SOL, never send to addresses outside a 5-address allowlist, never spend > 50 USDC/day. Today they just hope. Sentinel makes it a guarantee, with one YAML file and a one-line signer swap.

**P2 — x402 API consumer.** Pays per call to AI APIs via x402 (49% of x402 volume is on Solana). Wants per-endpoint rate limits and per-day caps. Currently sets a wallet allowance and prays. Sentinel intercepts the 402 handshake and rejects out-of-budget calls before signing.

**P3 — Ops/treasury team.** Runs internal automation that pays vendors, rotates LP positions, sweeps revenue. Needs auditable approval trails and the ability to escalate large transfers to a human. Sentinel produces a Dune SIM dashboard of every check, and a Phantom-style approval modal for escalations.

### Why now (market context — verify with sponsors)
- **Zerion's two Frontier tracks** ($10k each) explicitly ask for scoped agent policies and real transactions through their CLI. Our core product is the literal track description.
- **x402 on Solana** has 49% market share (per x402.org dashboard — verify number on the day of submission); no firewall exists for it.
- **ETH Cannes 2026** winner *ENShell* validated this exact pattern on Ethereum. Sentinel ports it to Solana — the playbook is proven.

### What Sentinel is NOT (anti-scope)
- Not a wallet. We never custody keys; we wrap an existing signer.
- Not an MPC product. No Shamir, no threshold, no FHE. Pure local rule evaluation + on-chain registry.
- Not a smart-contract auditor. We don't scan Anchor programs; we gate transaction *flow*.
- Not a relayer. We sign locally; we don't accept transactions from third parties.
- Not multi-chain (in MVP). Solana only. Cross-chain is post-hackathon.

---

## Part B — System architecture (high level)

### Components
| Component | Layer | Language | Responsibility |
|---|---|---|---|
| Policy DSL | Off-chain | YAML + TypeScript | Human-writable rules, compiled to canonical JSON + Merkle root |
| Registry program | On-chain | Rust (Anchor) | Stores `(agent_pubkey → policy_root, version, revoked_at)` |
| Signer shim | Off-chain | TypeScript | Wraps a Keypair-style signer; checks every tx against the active policy before signing |
| x402 interceptor | Off-chain | TypeScript (Express middleware) | Catches 402 challenges, maps to policy, auto-approves or escalates |
| Approval queue | Off-chain | Next.js + Postgres (or SQLite) | Holds escalated txs awaiting human decision |
| Dashboard | Off-chain | Next.js + Dune SIM API | Live view of policy hits, allow/deny rate, top spenders |

### Trust model (one paragraph)
The signer shim runs on the same machine as the agent — we are not adding a trusted third party. The on-chain registry is the *source of truth for which policy is currently active*; the shim refuses to sign if its local policy file's Merkle root doesn't match the on-chain root for the agent. This means an attacker who compromises the agent process cannot silently swap the policy: they would have to send a `revoke_policy` or `update_policy` transaction first, which is itself rate-limited and can require a separate hardware-wallet signature in the registry program. **Audit point:** the registry's update authority is the single most critical key in the system.

### Tech stack (locked — no substitutions during MVP)
- **Rust** 1.78+, **Anchor** 0.30+, **Solana CLI** 1.18+
- **Node** 20+, **TypeScript** 5+, **pnpm** (faster than npm for monorepos)
- **@solana/web3.js** ^1.95 (NOT `@solana/kit` — kit is the new SDK but Anchor's TS client still expects web3.js v1)
- **@coral-xyz/anchor** ^0.30
- **`yaml`** npm package (preferred over js-yaml — better types)
- **`zod`** for runtime schema validation of policies
- **Express** ^4 for the x402 interceptor
- **Next.js** 14 (app router) for dashboard
- **Dune SIM** for analytics

---

## Part C — Atomic execution plan

> **Convention.** Each task has an ID like `P1.T3` (Phase 1, Task 3). Verification is *binary*: either the listed command exits 0 / the listed assertion holds, or the task is not done.

---

### Phase 0 — Environment and due diligence (Day 1)

#### P0.T1 — Toolchain install
- **Goal:** machine has Rust, Anchor, Solana CLI, Node 20, pnpm.
- **Steps:**
  1. Install Rust via rustup; pin to 1.78.
  2. Install Solana CLI: `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` then `solana --version`.
  3. Install Anchor via `avm`: `cargo install --git https://github.com/coral-xyz/anchor avm --force` then `avm install 0.30.1` then `avm use 0.30.1`.
  4. Install Node 20 via `nvm` and pnpm via `corepack enable`.
- **Verify:** `solana --version`, `anchor --version`, `node -v`, `pnpm -v` all succeed.
- **Docs:**
  - Solana install — https://solana.com/docs/intro/installation
  - Anchor install — https://www.anchor-lang.com/docs/installation
- **Common failures:** Apple Silicon needs Rosetta for some Anchor BPF tooling; on Linux, `libudev-dev` and `pkg-config` must be installed before Anchor builds.

#### P0.T2 — Devnet wallet + airdrop
- **Goal:** a funded devnet keypair we'll use throughout the MVP.
- **Steps:**
  1. `solana-keygen new -o ~/.config/solana/sentinel-dev.json`
  2. `solana config set --url devnet --keypair ~/.config/solana/sentinel-dev.json`
  3. `solana airdrop 2` (retry on rate limit; web faucet at faucet.solana.com is the fallback).
- **Verify:** `solana balance` ≥ 1 SOL.
- **Docs:** https://solana.com/docs/intro/quick-start
- **Common failures:** devnet airdrop is rate-limited; if you hit the limit, switch IP or use the web faucet.

#### P0.T3 — Verify Zerion CLI surface (CRITICAL — do not skip)
- **Goal:** confirm whether Zerion's "agent CLI" exposes a pluggable signer interface. **The whole product depends on this.**
- **Steps:**
  1. Find Zerion's Frontier-track repo / docs (link from the track page on the Frontier site).
  2. Read the source for the signer abstraction.
  3. Try the smallest example end-to-end on devnet *with their default signer*.
  4. Replace their signer with a no-op stub that logs every call; confirm the agent still functions.
- **Verify:** at least one Zerion CLI agent transaction goes through with our stubbed signer in the path.
- **Docs:**
  - Zerion docs (general) — https://docs.zerion.io/ (verify the Frontier-specific repo on the day)
  - Frontier track page — get the latest URL from the hackathon dashboard
- **Failure response:** if Zerion CLI's signer is *not* pluggable in any clean way, **stop and reframe Sentinel as a generic Solana signer wrapper** (drop Zerion-specific track) and notify the team. Do not improvise a fork — the code review path with sponsors will fail.

#### P0.T4 — Verify x402 SDK on Solana
- **Goal:** know which x402 client library actually works on Solana (Coinbase's primary x402 implementation is Base/EVM-first; Solana support is newer).
- **Steps:**
  1. Read x402.org and find the canonical Solana client.
  2. Run their hello-world: an HTTP client that pays a 402-protected endpoint and gets a 200.
  3. Note the exact package name and version in `RESOURCES.md`.
- **Verify:** one successful 402 → 200 cycle on devnet.
- **Docs:**
  - x402 protocol — https://www.x402.org/
  - Coinbase x402 docs — search "x402 site:docs.cdp.coinbase.com" (URL changes; verify on the day)
- **Common failures:** the Solana x402 facilitator may require a registered API key; budget half a day for that.

---

### Phase 1 — Policy DSL (Days 2–3)

#### P1.T1 — Define the YAML schema
- **Goal:** a single, frozen policy schema. No additions until v2.
- **Schema (v1):**
  ```yaml
  version: 1
  agent: <base58 pubkey>
  caps:
    - token: SOL | USDC | <mint>
      max_per_tx: <number>     # optional
      max_per_day: <number>    # optional
      max_per_hour: <number>   # optional
  allowlist:
    destinations: [<base58 pubkey>, ...]   # if set, denies all others
  denylist:
    destinations: [<base58 pubkey>, ...]   # always denied
  programs:
    allow: [<program_id>, ...]   # if set, denies all others
  escalate_above:
    usd_value: <number>   # any tx above this -> human approval
  rate_limit:
    max_tx_per_minute: <int>
  ```
- **Verify:** schema compiled to a `zod` object that round-trips three example policies (small/medium/strict). All three example YAMLs live in `examples/policies/`.
- **Docs:** https://zod.dev/
- **Common failures:** YAML's `1`/`true`/`yes` ambiguity — use explicit string types in zod for tokens and pubkeys.

#### P1.T2 — Canonicalization + Merkle root
- **Goal:** the same policy YAML always produces the same 32-byte root, regardless of key order or formatting.
- **Steps:**
  1. Parse YAML → JS object.
  2. Run a deterministic JSON canonicalizer (`json-stable-stringify` or hand-rolled key sort).
  3. Hash with `sha256`. (Anchor uses `keccak256` for some ops but `sha256` is fine here — pick *one* and document it.)
  4. (Optional, if we want per-rule selective disclosure later: build a Merkle tree where each leaf is one rule. For MVP a single SHA-256 of the canonical JSON is enough — keep it simple.)
- **Verify:** unit test — same YAML through two different formattings (whitespace, key order) yields identical root.
- **Docs:**
  - JSON canonicalization — RFC 8785 (https://datatracker.ietf.org/doc/html/rfc8785)
  - Node `crypto.createHash('sha256')` — https://nodejs.org/api/crypto.html

#### P1.T3 — Rule engine (pure-function evaluator)
- **Goal:** given (policy object, transaction summary), return `Allow | Deny(reason) | Escalate(reason)`.
- **Steps:**
  1. Define `TxSummary` type: `{ token, amount, destination, programId, usdValue, timestamp }`.
  2. Implement evaluators for each primitive: caps, allowlist, denylist, programs, escalate, rate-limit.
  3. Combine with explicit precedence: `Deny` > `Escalate` > `Allow` (any rule denying → deny; otherwise any rule escalating → escalate).
- **Verify:** a `policy.test.ts` file with **15 fixtures** — 5 must `Allow`, 5 must `Deny` (one per primitive), 5 must `Escalate`. All green.
- **Docs:** https://vitest.dev/ (test runner)
- **Common failures:** time-window logic is the #1 source of bugs — store windows in UTC, never local time.

---

### Phase 2 — Anchor registry program (Days 4–6)

#### P2.T1 — Initialize Anchor workspace
- **Goal:** an Anchor project that builds and deploys a no-op program to devnet.
- **Steps:**
  1. `anchor init sentinel-registry --no-git`
  2. Set `cluster = "Devnet"` in `Anchor.toml`.
  3. `anchor build`
  4. `anchor deploy` — capture the program ID into `Anchor.toml` and `lib.rs`.
- **Verify:** `solana program show <program_id>` returns the deployed program; no error.
- **Docs:**
  - Anchor quickstart — https://www.anchor-lang.com/docs/quickstart
  - Anchor book — https://book.anchor-lang.com/
- **Common failures:** mismatched program IDs in `lib.rs` vs `Anchor.toml` after first deploy — fix both, rebuild, redeploy.

#### P2.T2 — `PolicyRecord` account
- **Goal:** an account type holding the registered policy.
- **Schema:**
  ```rust
  #[account]
  pub struct PolicyRecord {
      pub owner: Pubkey,        // 32 — who can update
      pub agent: Pubkey,        // 32 — the agent this policy governs
      pub root: [u8; 32],       // 32 — sha256 of canonical policy
      pub version: u32,         // 4
      pub revoked: bool,        // 1
      pub created_at: i64,      // 8
      pub updated_at: i64,      // 8
      pub bump: u8,             // 1
  }
  ```
  PDA seeds: `[b"policy", agent.key().as_ref()]`.
- **Verify:** account fits in the calculated space (`8 + 32 + 32 + 32 + 4 + 1 + 8 + 8 + 1 = 126` bytes); add 100-byte buffer for v2 fields → allocate 226.
- **Docs:**
  - Anchor accounts — https://www.anchor-lang.com/docs/account-types
  - PDAs — https://solana.com/docs/core/pda
- **Common failures:** forgetting the discriminator (8 bytes) in space calc.

#### P2.T3 — Instructions: `register`, `update`, `revoke`
- **Goal:** the three CRUD instructions, each with proper signer constraints.
- **Constraints:**
  - `register_policy(root, agent)` — PDA must not exist; owner = signer.
  - `update_policy(new_root)` — must be signed by `owner`; bumps `version`; updates `updated_at`; rejects if `revoked`.
  - `revoke_policy()` — signed by `owner`; sets `revoked = true`; *does not close the account* (we want history).
- **Verify:** Anchor TS test runs the full lifecycle: register → update (root changes) → attempt update by wrong signer (must fail) → revoke → attempt update after revoke (must fail).
- **Docs:**
  - Anchor instructions — https://www.anchor-lang.com/docs/instruction
  - Constraints — https://www.anchor-lang.com/docs/account-constraints

#### P2.T4 — Emit events
- **Goal:** every state change emits a structured event for the dashboard.
- **Steps:** add `#[event]` structs `PolicyRegistered`, `PolicyUpdated`, `PolicyRevoked` and `emit!()` calls inside each instruction.
- **Verify:** in the test, parse the transaction logs and confirm one event per instruction.
- **Docs:** https://www.anchor-lang.com/docs/events

---

### Phase 3 — Signer shim (Days 7–9)

#### P3.T1 — Define the `SentinelSigner` interface
- **Goal:** a drop-in replacement for `web3.js`'s `Signer`.
- **Surface:**
  ```ts
  interface SentinelSigner {
    publicKey: PublicKey;
    signTransaction(tx: Transaction): Promise<Transaction>;
    signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
  }
  ```
- **Verify:** TypeScript check — `const _: Signer = sentinelSigner` compiles.
- **Docs:** web3.js `Signer` — https://solana-labs.github.io/solana-web3.js/

#### P3.T2 — Tx → TxSummary parser
- **Goal:** turn a `Transaction` into the `TxSummary` the rule engine expects.
- **Steps:**
  1. Iterate `tx.instructions`; identify SPL-Token transfers, SOL transfers (System program), and arbitrary program calls.
  2. For SPL transfers, decode the instruction data (TransferChecked supplies amount + decimals; Transfer needs a mint lookup).
  3. Compute USD value via a pinned price oracle (Pyth pull oracle on devnet, or hardcoded mock for MVP — flag for later).
- **Verify:** `parser.test.ts` with three fixture transactions (SOL transfer, USDC transfer, swap) produces correct `TxSummary` objects.
- **Docs:**
  - SPL Token program — https://spl.solana.com/token
  - Pyth pull oracle (Solana) — https://docs.pyth.network/price-feeds/use-real-time-data/solana
- **Common failures:** versioned (v0) transactions with address lookup tables — for MVP, **explicitly reject v0 transactions** and document that limitation. v0 support is a v2 feature.

#### P3.T3 — On-chain policy fetch + cache
- **Goal:** when `signTransaction` runs, fetch the active `PolicyRecord` from chain (or cache) and verify the local policy file matches.
- **Steps:**
  1. Compute local YAML's root.
  2. Fetch on-chain `PolicyRecord` via Anchor client.
  3. Compare roots; if mismatch → throw `PolicyMismatchError`.
  4. Cache the on-chain root with a 30-second TTL; invalidate on `PolicyUpdated` event subscription.
- **Verify:** integration test — after `update_policy` on-chain, the next `signTransaction` call detects the mismatch and refuses.
- **Docs:**
  - Anchor TS client — https://www.anchor-lang.com/docs/clients/typescript
  - WebSocket subscriptions — https://solana.com/docs/rpc/websocket

#### P3.T4 — Rate-limit storage
- **Goal:** sliding-window counters for `max_per_day`, `max_per_hour`, `max_tx_per_minute`.
- **Steps:** simple SQLite-backed store (`better-sqlite3`); keys are `(agent, token, window)`. On each allow, append; on each check, sum within window.
- **Verify:** unit test — 10 quick txs against a 5/min limit → first 5 allow, next 5 deny.
- **Docs:** https://github.com/WiseLibs/better-sqlite3
- **Common failures:** time-zone bugs; clock drift between machines (only matters in multi-host deployments — flag for v2).

---

### Phase 4 — x402 interceptor (Days 10–12)

#### P4.T1 — Spike: replicate the x402 client flow
- **Goal:** confirm we can make the 402 → pay → 200 cycle work on Solana before wrapping it.
- **Steps:** stand up a tiny Express server with one 402-protected route; pay it from a Node client; observe the on-wire flow.
- **Verify:** server logs a successful payment; client receives a 200 with the resource.
- **Docs:**
  - x402 spec — https://www.x402.org/
  - Coinbase Solana x402 reference — search for the canonical repo on GitHub on the day (URL changes).

#### P4.T2 — Express middleware shim
- **Goal:** middleware that catches the *outgoing* 402 challenge inside our agent's HTTP client and routes it through Sentinel.
- **Steps:**
  1. Wrap `fetch` (or `axios`) with an interceptor that catches 402 responses.
  2. Parse the challenge → produce a `TxSummary`.
  3. Call the rule engine; on `Allow`, sign and pay; on `Escalate`, push to approval queue and return a 402 to the caller; on `Deny`, throw.
- **Verify:** end-to-end: an agent's `fetch('https://demo-x402.local/data')` either succeeds (auto-approved), 402-loops (escalated), or throws (denied) according to the active policy.
- **Docs:** undici interceptors — https://undici.nodejs.org/

#### P4.T3 — Three demo endpoints
- **Goal:** demoable surface for the video.
- **Endpoints:**
  1. `/cheap` — costs 0.001 USDC, always auto-approves under default policy.
  2. `/expensive` — costs 5 USDC, escalates above the daily cap.
  3. `/blocked` — destination on denylist, always denies.
- **Verify:** curl-ing each from the agent yields the expected outcome on screen.

---

### Phase 5 — Dashboard + approval UX (Days 13–15)

#### P5.T1 — Dune SIM ingestion
- **Goal:** a Dune SIM query that exposes our `Policy*` events plus a flat tx feed for the agent.
- **Steps:**
  1. Register the program ID with Dune SIM.
  2. Write a query that joins our events with raw tx metadata.
  3. Expose as a JSON endpoint via the SIM API.
- **Verify:** API call returns ≥ 1 row after we run the Phase 2 lifecycle test on devnet.
- **Docs:** https://docs.sim.dune.com/

#### P5.T2 — Next.js dashboard
- **Goal:** one page, three panels — *Live Activity*, *Policy Editor*, *Escalation Queue*.
- **Steps:** scaffold Next.js 14 app router; render server components fetching the Dune endpoint; client component for the editor (Monaco).
- **Verify:** `pnpm dev` shows the three panels populated against devnet data.
- **Docs:** https://nextjs.org/docs

#### P5.T3 — Approval modal (Phantom-style)
- **Goal:** an in-page modal that pops when the escalation queue receives a new item.
- **Steps:** Server-Sent Events from the agent process to the dashboard; modal component with *Approve* / *Reject* / *Approve and update policy* actions; the third action triggers a `update_policy` tx.
- **Verify:** trigger `/expensive` from the agent → modal appears within 2 s → clicking *Approve* lets the tx through; clicking *Reject* returns 403 to the agent.
- **Docs:** SSE in Next — https://nextjs.org/docs/app/api-reference/functions/next-response

---

### Phase 6 — Demo, docs, submission (Days 16–19)

#### P6.T1 — Demo video script
- **Goal:** 3-minute video, no live coding, runs in one shot on a fresh terminal.
- **Beats:**
  1. (0:00–0:30) Problem: agent with god-mode key, show a malicious tx that drains a wallet.
  2. (0:30–1:30) Wrap with Sentinel: write `sentinel.yml`, `sentinel deploy`, swap signer.
  3. (1:30–2:30) Replay the malicious tx → blocked. Three live demos: cheap (allow), expensive (escalate → approve in dashboard), blocked (deny).
  4. (2:30–3:00) Dashboard tour, on-chain registry tour, sponsor logos.
- **Verify:** record once, watch back, time it.

#### P6.T2 — README + quickstart
- **Goal:** a junior dev can clone the repo and reach the first allow/deny in 10 minutes.
- **Verify:** literally do that — fresh machine (or a Docker image), run the README top to bottom, time it.

#### P6.T3 — Sponsor pitches
- **Goal:** one paragraph per sponsor track explaining how Sentinel maps to their criteria.
- **Tracks to address:** Zerion #1, Zerion #2, Dune SIM, RPC Fast/Helius, 100xDevs, Adevar/Eitherway, Superteam India.
- **Verify:** post each in the relevant sponsor's TG/X channel by Day 17.

#### P6.T4 — Submit
- **Goal:** submission form filled before May 11 23:59 UTC, with 24-hour buffer.
- **Verify:** confirmation email received.

---

## Part D — Review-and-build loop (mandatory)

After **every phase**, run this checklist before starting the next one. If any item is red, fix or descope before proceeding.

| Check | How |
|---|---|
| All phase tests green | `pnpm test` in each package |
| All deployed accounts on devnet | `solana account <pda>` for the registry PDA |
| README updated for what's new | manual reread |
| One sentence in CHANGELOG.md | required |
| Demo path still works end-to-end | run the smallest happy path |
| Failure-mode list updated | for any new gotchas discovered |

**Failure-mode response.**
- A test fails twice → re-read the doc reference for that task before changing more code.
- A doc is unclear or out-of-date → write down what you observed, post the question to the sponsor's channel, and proceed with the safest interpretation.
- A whole phase is blocked > 1 day → tag the team, escalate the descoping decision, do not silently rewrite scope.

---

## Part E — Verified doc references (the only sources)

- Solana — https://solana.com/docs
- Anchor — https://www.anchor-lang.com/docs and https://book.anchor-lang.com/
- @solana/web3.js — https://solana-labs.github.io/solana-web3.js/
- SPL Token — https://spl.solana.com/token
- Pyth on Solana — https://docs.pyth.network/price-feeds/use-real-time-data/solana
- x402 protocol — https://www.x402.org/
- Dune SIM — https://docs.sim.dune.com/
- Next.js 14 — https://nextjs.org/docs
- Zod — https://zod.dev/
- RFC 8785 (JSON canonicalization) — https://datatracker.ietf.org/doc/html/rfc8785
- better-sqlite3 — https://github.com/WiseLibs/better-sqlite3

---

## Part F — Open verification items (do these in the first 48 hours)

| # | Item | Why it can sink the project |
|---|---|---|
| 1 | Zerion CLI signer is pluggable | Without this, the Zerion track ($20k) is out of reach |
| 2 | x402 Solana client is stable | If it's still EVM-only in practice, the x402 angle dies |
| 3 | Dune SIM supports the Solana program-event shape we need | If not, fall back to Helius webhooks |
| 4 | Pyth pull oracle works on devnet for our token set | If not, mock the USD oracle and document |
| 5 | Anchor 0.30+ doesn't have known IDL bugs against our nightly Solana | Pin both versions before any code goes in `main` |

If any of items 1–3 fail, **stop and re-scope.** Don't push through.