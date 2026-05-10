# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Phase 7 — Squads Smart Account as policy owner (2026-05-09)

Branch: `feature/squads-owner`. Composes Sentinel with Squads v4 multisig governance instead of competing with it. Decision-gate probe at hour ≤ 1.5 cleared.

#### Mechanism
- Sentinel's `PolicyRecord.owner` is `Signer<'info>` with `has_one = owner` — already accepts any Solana signer including a Squads vault PDA. **No on-chain code change required.**
- `packages/signer-shim/src/squads-owner.ts` adds the off-chain glue: `getSentinelVaultPda`, `fetchMultisigSnapshot`, `buildUpdatePolicyIx`, `buildRegisterPolicyIx`, `buildSquadsBundle` (offline: create / propose / approve), `buildSquadsExecuteTx` (online: execute), and `buildUpdatePolicyViaSquads` / `buildRegisterPolicyViaSquads` convenience wrappers.
- Bundle was split into offline (create/propose/approve, no RPC needed beyond a blockhash) and online (execute, requires `connection.getAccountInfo` to read the VaultTransaction record). Matches the real flow where execute happens *after* threshold approvals are reached.

#### Dashboard
- New `app/app/components/squads-connect.tsx`: paste a multisig PDA, see members + threshold + current transactionIndex, edit YAML → validate root → propose update via Squads → execute when threshold met. Mounted on the home page beneath the escalation approver.

#### Tests + probe
- `packages/signer-shim/src/squads-owner.test.ts`: 9 vitest fixtures covering PDA derivation parity, ix encoding, bundle shape, transaction-index sequencing, and connection-required guard.
- `scripts/probes/squads-probe.ts`: offline decision-gate probe. Builds PDAs + inner ix + Squads bundle without RPC. Snapshot at `/tmp/sentinel-squads-probe.json`. Wired as `pnpm probe:squads`.
- Workspace test count: 96 → 105 vitest + 6 anchor mocha = **111 green** total (signer-shim alone: 37 → 46; +9 squads-owner fixtures).

#### Narrative
- README rewritten: headline now "programmable **policy primitive** for Solana agent treasuries" (was "transaction firewall for autonomous Solana agents"). New paragraph cites a16z Crowley "Agency by design" (Dec 2025) and Colosseum's Sep 2025 RFP.
- Architecture table now lists Squads composition; sponsor track table adds Squads + Pyth and updates Adevar framing to "policy DSL + on-chain root + Squads compose".
- `docs/squads-owner.md`: full explainer (mechanism, trust-model deltas, flow, demo path, what's offline-tested vs devnet-only, limitations).
- `docs/eligibility-check.md`: India-eligibility verification checklist for sponsor tracks (operator action required — `WebFetch` could not access track-level eligibility text).

#### Why this and not a 2nd Anchor program
The previous council recommended a `spend-ledger` 2nd program for "on-chain depth optics." Colosseum-copilot research showed the closest competitor (Mercantill, Cypherpunk 2025 4th-place Stablecoins) already won money on a multi-sig + spending-controls product, *built on Squads Grid*. Adding our own multi-sig program would compete on Mercantill's turf. Sitting *behind* Squads as the policy primitive flips the framing: Sentinel is what other agent-treasury products plug into, not what they replace. Same code, stronger frame.

### A5 closed — real Zerion `ctx` captured (2026-05-03)

Front A is now fully verified: A1, A2, A3, A4, A5, A6 all on real captures.

#### Captures
- `/tmp/sentinel-zerion-ctx.json` (502 B) — `zerion sign-message sentinel-probe-test --chain ethereum` produced rich runtime ctx with `api_key_id`, `chain_id: eip155:1` (CAIP-2, **top-level**), `wallet_id`, `timestamp` (ISO-8601 w/ ns), `spending.{daily_total,date}`, `policy_config.scripts[]`, `transaction.raw_hex` (hex of message body).
- `/tmp/sentinel-zerion-ctx-swap.json` (236 B) — `zerion swap USDC ETH 2 --chain base` produced pre-assembly stub: `{transaction:{to:null,value:"0",data:"0x"}, policy_config:...}`. Probe denied with `{code:"policy_denied",message:"Blocked by policy",policy:"sentinelbot-standard"}` — closes C2 (live Zerion swap blocked) at the technical level.
- Evidence at `/tmp/sentinel-a5-evidence.txt`; full attempt log at `/tmp/sentinel-zerion-attempts.log`.

#### Adapter rewrite
- `packages/zerion-bridge/src/adapter.ts` rewritten against the real shape. Key corrections vs the prior tentative schema:
  - `chain_id` is **top-level**, not under `transaction`.
  - Format is **CAIP-2** (`eip155:*`, `solana:<genesis>`).
  - `transaction.raw_hex` (sign-message) is the message body, **not** a serialized tx — must not be parsed via `Transaction.from()`.
  - `transaction.data === "0x"` is real for swap pre-assembly (Zerion fires policy before route build).
- Decision rules: non-Solana → `null`; missing/stub → `[]`; sign-message → `[]`; parseable data → one summary per ix. The bridge's `sentinel.mjs` denies on `summaries.length === 0`, so opaque trade flows become deny-by-default.
- `adapter.test.ts` grew 4 → 11 fixtures; embeds the real captured shapes verbatim. Total zerion-bridge tests: 8 → 15 green.

#### Closure path discoveries
- `ZERION_ISOLATED=1` (disposable npm prefix) hits `policy_path_violation` — Zerion validates the policy script's absolute path against the canonical global install. Isolated mode is documented as safe-but-incompatible.
- `flock` claim corrected: it serializes other instances of *this script*, not ordinary `zerion` invocations from other terminals. Default mode is now `ZERION_ISOLATED=1` (safer); `ZERION_GLOBAL=1` is opt-in with confirmation prompt.
- The capture script (`scripts/probes/zerion-capture-ctx.sh`) supports `SENTINEL_A5_SCENARIO={discovery,swap-first,swap-only,sign-first}` and `SENTINEL_SWAP_CMD` overrides for targeted captures.

#### Limitation documented
Zerion's policy dispatcher is invoked **before** route/calldata assembly. Sentinel's Zerion-bridge therefore cannot reason about swap/bridge calldata pre-broadcast — only `chain_id` + sign-message metadata are observable. For richer Zerion enforcement, the path is post-broadcast Zerion subscription webhooks (documented in `docs/policy-context-shape.md` "Limitation" section). Sentinel's signer-shim path (autonomous Solana agents calling web3.js) is unaffected and sees fully assembled txs.

#### Tests
- zerion-bridge: 8 → 15 (+ 7 fixtures using real captured ctx)
- workspace total: 89 → 96 vitest + 6 anchor = **102 green**

### Production hardening pass (2026-04-30)

Driven by 4 parallel audit agents (security, code-quality, silent-failure, test-coverage). 30+ findings; CRITICAL + HIGH + most MEDIUM applied. Tests grew **73 → 89 vitest** (+ 6 anchor mocha), all green. Workspace typecheck + Next production build green.

#### CRITICAL
- **Webhook auth: timing oracle closed.** `app/app/api/webhook/route.ts` — replaced `got !== expected` (short-circuit byte compare leaks secret length over many requests) with `crypto.timingSafeEqual` after equal-length normalization. Accepts both `Bearer <secret>` and legacy raw header. Body size capped at 256KB before `JSON.parse` to defend against memory blow-up.
- **Webhook replay protection.** Added `UNIQUE INDEX idx_events_signature ON policy_events (signature) WHERE signature IS NOT NULL` and switched insert to `INSERT OR IGNORE`. Re-delivered Helius payloads no longer duplicate spend events. Response now reports `{ingested, deduped}`.
- **Escalations API authenticated.** `app/app/api/escalations/route.ts` — POST now requires `x-sentinel-token` header verified via `crypto.timingSafeEqual` against `SENTINEL_DASHBOARD_TOKEN`. Dev fallback gated behind explicit `SENTINEL_ALLOW_UNAUTH_DASHBOARD=1` opt-in (never silent). Status flips return 404 on missing IDs and 409 on already-resolved rows (was: silent OK).
- **Confused-deputy in approve-and-update closed.** `escalation-approver.tsx` no longer takes `agentInput` and `rootHex` as free-text inputs. The agent pubkey is locked to the escalation row's `agent` field; the operator pastes new policy YAML which goes through `/api/policy` server validation; the canonical sha256 root is rendered before signing. An attacker who could inject an escalation can no longer choose what root the operator's wallet authorizes on-chain.

#### HIGH
- **TOCTOU YAML re-read.** `sentinel-signer.ts` now stats the policy file on every `signTransaction` and re-parses if `mtimeMs` changed since last load. A local attacker swapping the file post-construction is no longer invisible to `ensureMatch`.
- **YAML alias-bomb defense.** Policy parsing now runs with `{ maxAliasCount: 100 }`; file size capped at 64KB pre-read.
- **`onLogs` → `onAccountChange`.** `policy-fetch.ts` previously invalidated cache on substring match of program logs (forgeable: any tx mentioning the PDA as a read-only account triggered cache flush; conversely, log truncation could drop a real update silently). Now subscribes to PDA account-data changes — strict signal, unforgeable. If WS subscription fails at boot, `effectiveTtl` is forced to 0 so every signing call hits RPC (slow > stale).
- **On-chain agent cross-check.** `policy-fetch.ts` now asserts `record.agent.equals(opts.agent)` before trusting the root. Guards against PDA seed mismatches from a misconfigured program ID.
- **`POLICY_MISMATCH` info disclosure scrubbed.** Error details no longer include the on-chain root hex — a malicious agent in the same trust domain otherwise gets a free oracle for "is this YAML candidate the deployed one?". Local hex stays (the agent's own file).
- **Deny-by-default for unknown programs.** `tx-parser.ts` adds `programsAllow` to `ParseEnv`; signer threads `policy.programs?.allow` in. Any program other than System / Token v1 / Token-2022 (which is rejected) throws `UNSUPPORTED_TX` unless explicitly listed. Removes the "ix targets unknown program → engine sees `amount: 0` summary → silent allow" attack.
- **Per-agent rate-limiter prune.** `rate-limiter.ts` `prune()` is now scoped via `WHERE agent = ? AND timestamp < ?`. Previously, signer construction wiped spend history for *every* agent sharing the SQLite file (multi-agent host weakening).
- **Atomic `signAllTransactions`.** Previously, batched signing recorded spend for tx 1..N-1 even when tx N was denied. Now: every tx is parsed-and-evaluated first (throws on first deny/escalate without recording); only after all txs pass is spend recorded and signatures applied. Caller retry no longer double-counts.
- **Escalations `requirements` schema-validated + size capped at 4KB.** Was `z.unknown()` accepting arbitrary blobs.

#### MEDIUM
- **`zerion-bridge/sentinel.mjs` syntax bug fixed.** `getHistory` was a non-async function with `await import` inside (parse error). Made async + dropped unused `existsSync` import.
- **Empty summaries → deny in zerion bridge.** Previously, an adapter that returned `[]` (no decodable instructions) silently allowed the tx, bypassing caps. Now refuses.
- **Env name canonicalization (Bug #4).** `SENTINEL_REGISTRY_PROGRAM_ID` is canonical across `app/lib/env.ts`, `helius.ts`, `page.tsx`, and the Helius decoder. `SENTINEL_PROGRAM_ID` accepted as legacy alias. Fixed silent test pass where `helius.test.ts` set the wrong name and the configured-program code path was never exercised.
- **`parseRequirements` adversarial input.** `interceptor.ts` now rejects empty/non-string input, unparseable JSON, negative/non-finite `amount`, and oversized headers (>4KB). Wrapped `JSON.parse` in try/catch with typed error.
- **Anchor `revoke_policy` idempotency.** `lib.rs` `RevokePolicy` accounts now carry `constraint = !policy.revoked @ SentinelError::PolicyRevoked`. Re-revoking an already-revoked policy errors instead of emitting a redundant `PolicyRevoked` event.
- **Canonicalize stringifies parsed shape, not input.** `canonicalize.ts` was discarding `parsePolicy(policy)` return value and stringifying the original — fine under strict zod today, drift waiting to happen if anyone loosens to `.passthrough()`. Now uses the validated form.
- **App env schema completeness.** Added `NEXT_PUBLIC_SOLANA_RPC`, `SENTINEL_DASHBOARD_TOKEN`, `SENTINEL_ALLOW_UNAUTH_DASHBOARD`, `NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN`, `NEXT_PUBLIC_SENTINEL_REGISTRY_PROGRAM_ID` to the zod boot validator. Production refuses to start without `SENTINEL_DASHBOARD_TOKEN` unless explicit opt-out.

#### Test fixtures added
- `signer-shim`: `RATE_LIMITED` surfaced via `POLICY_VIOLATION` when sliding window full; unknown program → `UNSUPPORTED_TX`; YAML mtime change re-reads policy and applies new allowlist (TOCTOU defense).
- `policy-fetch`: `onAccountChange` callback fires → cache invalidates → next ensureMatch refetches; subscription failure forces `ttl=0`; on-chain agent mismatch → `REGISTRY_FETCH_FAILED`.
- `policy-dsl/engine`: mint-token caps evaluated (not just SOL/USDC literals); cap-deny precedence over rate-limit-deny when both fire; exact-cap boundary (`spent == max_per_day`, `amount: 0`) → allow.
- `app/lib/helius`: missing/empty instructions; missing accounts/data; sub-8-byte data → `kind: unknown` without throwing.
- `x402-interceptor`: empty input, non-JSON, negative/NaN amounts, oversized header — all throw with descriptive errors.

#### Breaking changes
- `app/app/api/escalations` POST now requires `x-sentinel-token`. Set `SENTINEL_DASHBOARD_TOKEN` in production or `SENTINEL_ALLOW_UNAUTH_DASHBOARD=1` in dev. The dashboard component reads `NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN`.
- `revoke_policy` is no longer idempotent — re-revoking errors. Callers must check `record.revoked` first.
- `tx-parser.parseTx` accepts a new optional `programsAllow` field on `ParseEnv`. Calling without it makes any non-System / non-Token-v1 program throw `UNSUPPORTED_TX`. The signer-shim sets this from `policy.programs?.allow` automatically.
- Webhook responses now include `{ingested, deduped}` instead of `{ingested}`.

### Added (A3 live x402, 2026-04-28)
- **A3 closed:** live x402 SOL payment confirmed on devnet. Signature `4gzawvk5b3itH5A28HK8AYt9ehALYCmpF8BP6sGimJpLTryXN8anSMyC7E5cLdPe5o1JfKybASPQ86adRs8cchgE`, `solana confirm` → "Finalized".
- **`packages/x402-interceptor/src/payment-builder-live.ts`:** native web3.js v1 PaymentBuilder. SDK options rejected: `@quicknode/x402-solana` pulls `@solana/kit` (incompatible with our locked v1), `@faremeter/payment-solana` is LGPL-3.0 (clashes with MIT-as-open-primitive). Real blockhash, `sendRawTransaction` + `confirmTransaction`, auto-create destination ATA for SPL.
- **Server-side on-chain verification:** `x402Protect` gained `verifyOnChain: { connection, commitment }` option. Middleware extracts signature from `X-PAYMENT` header, queries `getSignatureStatus`, accepts only when commitment matches and `err === null`. Logs accept/reject reason.
- **`scripts/probes/x402-live.ts`** + `pnpm probe:x402-live` — end-to-end probe spinning up server + signer + live builder. Verification gate: 200 OK from server (only after on-chain confirm) AND treasury balance change confirmed.

### Added (A6 + B3 cluster-aware bifurcation, 2026-04-28)
- **A6 closed:** Dune SIM `/beta/svm/balances` round-trip verified (26ms, 200 OK). SIM is mainnet-only — devnet wallets always return `balances_count: 0`. `app/lib/balance.ts` now bifurcates: devnet uses `Connection.getBalance` + `getParsedTokenAccountsByOwner` (Helius RPC when `HELIUS_API_KEY` is set), mainnet uses SIM. Same response shape; UI renders a `[live · devnet RPC]` or `[live · Dune SIM (mainnet)]` badge so judges see the source. Live test: 5.5 SOL + 200 SPL tokens for the funded devnet wallet `7BQ1jaQh…`.
- **B3 spend graph:** `app/lib/spend.ts` + `/api/agent-spend` + `app/app/components/agent-spend-chart.tsx` (SVG bar+line over 7 days). Devnet path uses `getSignaturesForAddress` + per-sig `getParsedTransaction` (Helius free tier rejects batch RPC). Live test: 3 txs / +5.5 SOL net over 7d.
- **`app/lib/rpc.ts:resolveRpcUrl()`:** picks Helius RPC over public devnet (`api.devnet.solana.com` rate-limits at ~1 req/s and 429s every 5th request).
- **`scripts/probes/balance-spend.ts`:** end-to-end probe that exercises both paths and prints real source-tagged data.
- `scripts/probes/sim.ts` upgraded to detect `balances_count == 0` and warn explicitly that SIM is mainnet-only with the suggested mainnet-pubkey re-probe.
- `docs/sim-response.md` rewritten to document the bifurcation, the Helius free-tier batch-RPC restriction, and the verified live output.

### Added (Front A live + B1/B2/B4 + C3 + Front E, 2026-04-28)
- **A1 closed:** sentinel-registry deployed to devnet at `2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk` (slot 458640454). IDL + types committed.
- **A2 closed:** Helius enhanced webhook live; real payload captured (sig `kVBhPzzSyaE2v1kV…`, plen 1540, 2026-04-28T16:54Z). `docs/helius-payload.md` upgraded from PLACEHOLDER to real shape with Anchor discriminator table.
- **A4 closed:** real Pyth Hermes SOL_USD response captured to `docs/pyth-response.md`.
- **B2 wallet adapter:** `app/app/components/{wallet-provider,wallet-controls}.tsx` mounts ConnectionProvider + WalletProvider + Phantom + Solflare with autoConnect. Phantom's hardware-wallet pass-through covers the Ledger requirement from `docs/TRUST_MODEL.md` with no extra integration. Header shows `[DEMO MODE]` warning until connect.
- **B1 approval modal mounted:** `app/app/components/escalation-approver.tsx` polls `/api/escalations` every 2s, mounts `approval-modal.tsx` for first pending row. "Approve" opens an inline panel that builds an `update_policy` ix client-side (8-byte discriminator + 32-byte root, policy PDA via `[b"policy", agent]`), feeds to `wallet.signTransaction`, broadcasts via `Connection.sendRawTransaction`, then POSTs `approve_and_update` to `/api/escalations`.
- **B4 seed-demo:** `scripts/seed-demo.ts` (now `pnpm seed`) inserts 3 policy_events + 3 escalations (1 pending) into `app/.data/sentinel.db` so judges land on a populated UI. Idempotent.
- **A2 helpers:** `scripts/probes/fire-register-policy.ts` (live-tested, sig `5Gb3XZH…`) + `scripts/probes/check-webhook.ts` diagnostic + `scripts/seed-demo.ts`.
- **C3 decoded events:** `app/lib/helius.ts` rewritten — base58 decoder + Anchor discriminator match. `DecodedEvent` carries `kind`, `agent` (from register_policy args), `policyPda`, `owner`, `rootHex`. `policy_events.decoded` column added (auto-ALTER on existing DBs). SSE stream + `live-activity.tsx` render decoded agent + truncated root with kind-color badges. 4 vitest fixtures using the captured 2026-04-28 payload.
- **D6 env validation:** `app/lib/env.ts` + `packages/signer-shim/src/env.ts` — zod schemas, fail-loud on bad config.
- **D9 Token-2022 reject:** `tx-parser.ts` throws `TOKEN_2022_NOT_SUPPORTED` for Token-2022 program ix; new error code; fixture in `tx-parser.test.ts`.
- **D7 Cargo.lock context:** `RESOURCES.md` documents which Anchor/SBF toolchain combination the lock pins target.
- **Open primitive:** `LICENSE` MIT at root (Council recommendation).
- **Front E (RuFlo):** 5 ADRs in `docs/adr/0001-on-chain-root-invariant.md` through `0005-sqlite-for-escalations.md`. `docs/architecture/domains.md` maps 5 bounded contexts (policy/signing/payment/escalation/audit) with ubiquitous language + contracts. RuFlo aidefence_scan returned safe (0 threats, 0 PII). ADR summary stored in RuFlo memory `sentinel` namespace with HNSW embedding.
- **Trust model:** `docs/TRUST_MODEL.md` documents owner-key-as-PoF, what Sentinel does/doesn't defend against, Ledger requirement.
- **Plan + learnings:** `SUBMISSION_PLAN.md` (5-front plan with binary submission gate). `docs/learnings.md` (5 hardest bugs, 600 words, for 100xDevs track).

### Changed
- `app/app/api/webhook/route.ts` — D4 env check moved into request handler (was at module load) to avoid `next build` collect-page-data trip; returns 503 instead of 401 when secret missing.
- `app/app/api/stream/route.ts` — selects `decoded` column.
- `packages/signer-shim/src/sentinel-signer.ts` — D3 prune-on-startup of spend_log entries older than 7d.
- `packages/zerion-bridge/src/sentinel.mjs` — D5 policy.yml cache TTL 5s → 30s.
- `packages/x402-interceptor/src/payment-builder-stub.ts` — uses real source-side ATA derivation; destination still passes wallet pubkey because tx-parser cannot reverse ATA → owner without RPC. Replaced fully by live builder in A3.
- `packages/signer-shim/src/errors.ts` — adds `TOKEN_2022_NOT_SUPPORTED`.

### Spec deviations (logged per §0.3)
- Anchor.toml `[scripts] test` switched from `pnpm vitest run --dir tests` (Implementation.md §2.2) to `ts-mocha` per §6.2 (chai + before).
- `payment-builder-stub` builds an instruction with the wallet pubkey in the destination key rather than a derived ATA. Intentional offline-only stub; replaced by `payment-builder-quicknode.ts` in A3 with ATA→owner inversion in tx-parser.

### Earlier work
- Workspace scaffold: pnpm workspace, tsconfig.base, Cargo workspace, Anchor.toml.
- Package skeletons for `policy-dsl`, `signer-shim`, `x402-interceptor`, `zerion-bridge`.
- Program skeleton at `programs/sentinel-registry` with `register_policy` / `update_policy` / `revoke_policy`.
- Example policies (small, medium, strict) under `examples/policies/`.
- `@sentinel/policy-dsl`: zod schema (v1, `.strict`), RFC 8785 canonicalizer + sha256 root, pure-function rule engine with deny>escalate>allow precedence, 25 vitest fixtures green.
- `programs/sentinel-registry`: Anchor 0.32 program with `register_policy` / `update_policy` / `revoke_policy` instructions, `PolicyRecord` PDA (seeds `[b"policy", agent]`, `#[derive(InitSpace)]`, 100-byte `_reserved` buffer), `has_one = owner` constraints, post-revoke update rejection, `PolicyRegistered` / `PolicyUpdated` / `PolicyRevoked` events.
- `tests/sentinel-registry.ts`: full lifecycle Anchor test green on localnet (6 tests: register, update+bump, non-owner rejection, revoke, post-revoke rejection, event emission).
- Workspace Cargo.lock pins to keep SBF cargo 1.84 happy: `proc-macro-crate=3.3.0`, `toml_datetime=0.6.11`, `toml_edit=0.22.27`, `indexmap=2.10.0`, `unicode-segmentation=1.12.0`.
- `@sentinel/signer-shim`: `SentinelSigner` (web3.js Signer-compatible), `tx-parser` (System+SPL Token, v0 rejection, mint-decimals cache), `price-oracle` (Pyth Hermes pull, 60s stale rule, USDC peg sanity check), `policy-fetch` (on-chain root compare, 30s TTL, log-subscription cache invalidation), `rate-limiter` (better-sqlite3 sliding window, in-memory variant for tests). 30 vitest fixtures green across 5 test files.
- `@sentinel/zerion-bridge`: `sentinel.mjs` ESM file Zerion loads as a policy script, `adaptCtx` placeholder for the probed Zerion `ctx` shape, `install` CLI that drops the script into `~/.config/zerion/policies/`. 4 adapter tests green.
- `@sentinel/x402-interceptor`: `createSentinelFetch` (catches 402, runs through SentinelSigner, retries with X-PAYMENT header), `x402Protect` Express middleware, `createStubPaymentBuilder` (offline-capable), runnable demo-server (`/cheap`, `/expensive`, `/blocked`) and demo-client. 5 interceptor tests green.
- `app/`: Next.js 14 dashboard. Pages: `/` (live activity, escalation queue, policy editor with Monaco YAML, balance widget). API routes: `/api/webhook` (Helius receiver with optional auth), `/api/escalations` (GET pending + POST resolve/create), `/api/balance` (Dune SIM proxy with 30s cache + stub fallback when no key), `/api/policy` (validate YAML + return canonical SHA-256 root), `/api/stream` (SSE 1Hz). SQLite via `lib/db.ts` with `policy_events` and `escalations` tables. Production build green, all routes smoke-tested with curl.
- `README.md`, `docs/demo-script.md` (frame-by-frame 3-min video script), `docs/submission-checklist.md`, and one-paragraph pitches under `docs/pitches/` for all seven sponsor tracks (zerion-1, zerion-2, dune-sim, helius-rpc-fast, 100xdevs, adevar-eitherway, superteam-india).

### Changed
- Anchor.toml `[scripts] test` switched from `pnpm vitest run --dir tests` (Implementation.md §2.2) to `ts-mocha` to match the test file shape in §6.2 (uses `chai` + `before`). Per §2.6 (`anchor test` uses Mocha by default).