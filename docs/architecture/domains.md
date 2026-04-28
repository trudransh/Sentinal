# Sentinel — Bounded contexts (DDD)

A map of Sentinel's bounded contexts, the ubiquitous language inside each, and
the contracts at their boundaries. Drawn from the `packages/*` and `app/*`
layout, validated against the live integration as of 2026-04-28.

## Five bounded contexts

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│   ┌───────────┐         ┌───────────┐         ┌───────────┐            │
│   │  policy   │──root─▶ │  signing  │ ──ix──▶ │  payment │            │
│   │ (DSL)     │         │ (shim)    │         │ (x402)    │            │
│   └───────────┘         └─────┬─────┘         └─────┬─────┘            │
│         ▲                     │                     │                  │
│         │                     │ verdicts            │ receipts         │
│         │                     ▼                     ▼                  │
│         │                ┌───────────┐          ┌───────────┐           │
│         └─── policy ──── │ escalation│         │   audit   │           │
│              decisions   │ (queue)   │         │ (events)  │           │
│                          └───────────┘         └───────────┘           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## 1. Policy

Owns: rules, canonicalisation, verdict computation, on-chain root.

Lives in: `packages/policy-dsl/`, `programs/sentinel-registry/`.

Ubiquitous language:

- **Policy** — the YAML-loadable, zod-validated `PolicyV1` document.
- **Root** — 32 bytes, `sha256(rfc8785_canonicalize(policy))`.
- **Verdict** — `{ type: "allow" }`, `{ type: "escalate", reason }`, `{ type: "deny", reason }`.
- **Rule family** — denylist, allowlist, programs.allow, caps, rate_limit, escalate_above.

Contracts (in):

- A `Policy` from YAML or JSON
- A `TxSummary` (from signing context)
- A `SpendHistory` (from rate-limiter)

Contracts (out):

- A `Verdict` (pure function — `evaluate(ctx)`)
- A `Root` (`policyRoot(policy) → Uint8Array`)
- An on-chain `PolicyRecord` PDA, queryable by any client

## 2. Signing

Owns: tx parsing, on-chain root verification, signing decision, rate-limit recording.

Lives in: `packages/signer-shim/`.

Ubiquitous language:

- **SentinelSigner** — implements `web3.js.Signer`, refuses on policy mismatch
- **Tx-parser** — decodes System + SPL Token (TransferChecked + legacy) into `TxSummary`s
- **Policy fetcher** — caches on-chain root, invalidates on `onLogs` of the registry program

Contracts (in):

- A web3.js `Transaction` to sign (rejects `VersionedTransaction` and Token-2022)
- A `Connection` (RPC) for policy fetch + mint decimals
- A `PriceOracle` (Hermes pull, see ADR 0003)

Contracts (out):

- A signed `Transaction` (only on Allow)
- A `SentinelError` with discriminated `code` (only on Deny / Escalate / Mismatch)
- A side-effect: `RateLimiter.record(summary)` for accepted txs

## 3. Payment

Owns: x402 protocol, payment-builder abstraction, receipt encoding.

Lives in: `packages/x402-interceptor/`.

Ubiquitous language:

- **PaymentRequirements** — parsed from server's `X-PAYMENT-REQUIREMENTS` header
- **PaymentBuilder** — interface; offline stub today, `@quicknode/x402-solana` planned (A3)
- **PaymentReceipt** — `{ signature, txBase64, payTo, ... }` posted in `X-PAYMENT` header on retry

Contracts (in):

- A `PaymentRequirements` (from a 402 response)
- A `SentinelSigner` (delegates the verdict)
- A `PaymentBuilder` (constructs the actual Solana tx for the payment)

Contracts (out):

- A retried `Response` with `X-PAYMENT` set on success
- A `PaymentDeniedError` or `PaymentEscalationRejectedError` on policy reject

## 4. Escalation

Owns: human-in-the-loop approval queue.

Lives in: `app/app/api/escalations/`, `app/app/components/{escalation-queue,escalation-approver,approval-modal}.tsx`.

Ubiquitous language:

- **Escalation** — a row in the SQLite `escalations` table; status ∈ {pending, approved, rejected}
- **Ticket** — the in-flight version held by the signer-shim (`SentinelError.details.ticket`) before it lands in the queue
- **Operator** — the human approving; in production this is a Ledger-backed wallet (ADR/TRUST_MODEL.md)

Contracts (in):

- An `EscalationTicket` from the signing context (today, manual; in future, the
  signer's `onEscalate` handler can POST it directly)
- An operator decision (approve / reject / approve_and_update via wallet adapter)

Contracts (out):

- A status update in SQLite (`approve` / `reject`)
- A signed `update_policy` Solana tx (on `approve_and_update`) — pushed via
  the connected wallet (Phantom/Ledger/Solflare)

## 5. Audit

Owns: visible history of policy events for the dashboard.

Lives in: `app/app/api/webhook/`, `app/app/api/stream/`, `app/app/components/live-activity.tsx`.

Ubiquitous language:

- **Policy event** — a row in `policy_events`, kind ∈ {registered, updated, revoked}
- **Live activity** — the SSE stream pushing the latest 5 events to the dashboard
- **Helius enhanced payload** — `docs/helius-payload.md` shape

Contracts (in):

- A `HeliusEnhancedTx` from the webhook (real shape captured 2026-04-28)
- A `HELIUS_WEBHOOK_SECRET` for auth

Contracts (out):

- A timestamped row in SQLite
- An SSE `tick` event every 1Hz to connected dashboards
- (Future, C3) decoded events with extracted `agent` from instruction data

## Why these boundaries

- **Policy** is the only context with both off-chain (TS) and on-chain (Rust)
  artifacts. Its boundary is the 32-byte root.
- **Signing** is the only context that touches a wallet's secret key. Everything
  else operates on transactions or summaries.
- **Payment** wraps the x402 dance; it depends on Signing but is otherwise
  independent — the same SentinelSigner could front a non-x402 caller.
- **Escalation** is the only context with human input. Its boundary is the
  operator's wallet (sign-and-broadcast) and SQLite state transitions.
- **Audit** is read-only from the system's POV (write-only from Helius).

## What the layout enforces

- `policy-dsl` has zero Solana dependencies — it can be embedded in any signer.
  This is the "open primitive" claim from the Council deliberation: another
  team could ship a Phantom Embedded extension that uses our DSL without
  taking on web3.js.
- `signer-shim` depends on `policy-dsl` but not on `x402-interceptor` or any
  app code. The interceptor depends on the shim, not the other way round.
- The Anchor program lives in `programs/sentinel-registry/` and has zero
  TypeScript dependencies. The IDL is the only artifact that flows back into
  the TS world.

## Open boundary questions (to revisit post-hackathon)

- **Signing ↔ Escalation feedback loop.** Today, the signer throws
  `ESCALATION_REQUIRED` and the caller (interceptor) handles it. The dashboard
  doesn't know about the escalation until the operator manually inserts it.
  A clean boundary would be: signer POSTs to `/api/escalations` directly.
- **Audit ↔ Policy correlation.** The Audit context can see policy roots in
  decoded events but doesn't compare them to Policy's local state. C3 closes
  this gap by surfacing decoded events including `root`.
