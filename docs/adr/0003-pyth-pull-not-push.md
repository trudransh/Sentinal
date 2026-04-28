# ADR 0003 — Pyth Hermes pull oracle off-chain (not on-chain push)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-04-28 |
| Driver | Phase 3 (signer-shim oracle) |

## Context

`escalate_above.usd_value` requires converting a SOL or USDC amount to USD.
Pyth offers two delivery modes on Solana:

1. **On-chain push**: a price account that updates every slot. Read via
   account fetch.
2. **Off-chain pull (Hermes)**: HTTPS endpoint returns a signed price update.
   Optionally posted on-chain with `pyth-solana-receiver`.

The signing decision happens in the signer-shim, off-chain, before any tx is
submitted.

## Decision

Use **Hermes pull** via `@pythnetwork/hermes-client`. SOL_USD feed
`0xef0d8b6fda…` and USDC_USD feed for the peg sanity check (±5%). Reject
prices older than 60s (`stale_ms` constant). On 60s-stale or non-200, raise
`ORACLE_UNAVAILABLE` and bubble it as the most-conservative outcome (treat
USD value as `+∞`, which forces escalation/deny depending on policy).

Captured live response shape verified in `docs/pyth-response.md` (probed
2026-04-28T10:40:24).

## Consequences

**Positive**
- No on-chain account dependencies → signer works without a Solana RPC
  configured (still needs RPC for policy-fetch, but the oracle is independent)
- Sub-second latency in practice (~1.2s elapsed to Hermes from devnet test)
- Free — no per-update on-chain rent
- Integrates cleanly with `policy-dsl`'s `evaluate(ctx)` because evaluation is
  a pure function and the oracle call happens in `tx-parser` before evaluate

**Negative**
- Adds an external HTTPS dependency at signing time. Mitigation: 60s freshness
  rule + USDC peg sanity check + fail-closed on oracle outage
- A compromised Hermes endpoint could flip a verdict by reporting a stale
  cheap price. The peg sanity check on USDC catches the most obvious case;
  a more aggressive check would be a cross-validation against a second
  feed (post-hackathon)

## Alternatives rejected

- **On-chain push read**: harder to bound staleness without time oracles, and
  reading from off-chain Node would still need an RPC. Worse on both axes.
- **No oracle, deny everything > 0**: too restrictive. Many sensible policies
  want "allow up to $5, escalate beyond" which requires USD.
- **Switchboard**: viable; not chosen because Pyth's pull SDK is more
  ergonomic and Pyth has the prize-eligible track this hackathon doesn't
  reward.

## Verification

`packages/signer-shim/src/price-oracle.ts` + `price-oracle.test.ts` — 6
fixtures including stale rejection and peg-sanity rejection. `scripts/probes/pyth.ts`
ran live and emitted `docs/pyth-response.md`.
