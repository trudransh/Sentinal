# Threat model

Mirror of `Implementation.md` §3, kept here so the doc lives next to the code it constrains.

## What Sentinel protects

| Asset | Threat | Mitigation |
|---|---|---|
| Agent's signing key | Compromised agent process signs unauthorized tx | Local rule check before signing; on-chain root mismatch refuses to sign |
| Policy contents | Attacker swaps local YAML | On-chain root comparison; any drift → `POLICY_MISMATCH` |
| On-chain policy | Attacker hijacks `update_policy` | `has_one = owner` constraint; `owner` should be a hardware wallet on a separate machine |
| Approval queue | Attacker injects fake approvals | SSE channel authenticated via short-lived bearer token; CSRF on approval form |

## Out of scope

- Logic bugs *inside* the agent that produce in-policy but unwanted txs.
- Network-level attacks (RPC MITM) — assume `https`.
- Social engineering of the operator.

## System invariants

1. No tx is signed without a fresh policy fetch (subject to 30s cache TTL with WS invalidation).
2. `PolicyRecord.revoked == true` ⇒ no signature ever.
3. Rate-limit storage is monotonic. We never decrement counters.
4. Pyth prices ≥ 60s old are never trusted. Stale price ⇒ `escalate`.
5. Versioned (v0) transactions are rejected in MVP.
6. Every state change on-chain emits an event.
7. The policy root is the *only* identity bind between local YAML and on-chain state.
