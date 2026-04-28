# ADR 0001 — On-chain policy root as the single source of truth

| | |
|---|---|
| Status | Accepted |
| Date | 2026-04-28 |
| Driver | Front A (devnet integration) |
| Supersedes | — |

## Context

A signer-shim runs co-located with the agent. The agent is the threat. If the
agent can rewrite the local YAML policy on disk, it can authorise itself to
sign anything. We need an authority on policy that the agent cannot tamper with
locally.

Three options were on the table:

1. **Trust local YAML.** Just rely on file-system permissions. Fast, zero infra.
2. **HTTPS endpoint** behind operator auth that returns the canonical policy.
   Adds a server, auth model, secrets, and a downtime story.
3. **On-chain Anchor program** holds a 32-byte sha256 root. The shim refuses
   to sign on root-mismatch.

## Decision

Option 3 — Anchor `sentinel-registry` program holds `(owner, agent, root[32], version, revoked)` per `[b"policy", agent]` PDA. The signer-shim canonicalises the local YAML (RFC 8785) → sha256 → compares to the on-chain root every signing decision (with 30s TTL + log-subscription cache invalidation). Mismatch → throw `POLICY_MISMATCH` and refuse.

**Trust posture:** the on-chain root *is* the policy. The local YAML is just a
performance cache; if it diverges, the shim refuses. This makes the agent
unable to grant itself permission by editing a file — the only attacker who
can change effective policy is one with the **owner** keypair (see
`docs/TRUST_MODEL.md`, ADR 0006).

## Consequences

**Positive**
- Single canonical source of truth, queryable from any client
- Update authority is constrained by the program's `has_one = owner`
- Helius webhook → dashboard live activity comes for free
- Open primitive: any other signer (Phantom Embedded, Squads) can read the
  same root and enforce the same policy without coordinating with us

**Negative**
- Adds RPC dependency (signing is now network-bound). Mitigated by 30s TTL.
- Update latency — operator must wait for confirmation before next signing
  decision sees the new root
- Compromised RPC can lie. Pin RPC, monitor `policy_events` for unexpected
  updates, alert externally (documented in `docs/TRUST_MODEL.md`).

## Alternatives rejected

- Local-YAML-only: discarded because the agent runs in the same trust domain
  as the YAML file; nothing prevents the agent from rewriting it.
- HTTPS endpoint: adds an attack surface (the endpoint becomes the new keypair
  problem) without removing the central trust point.

## Verification

`packages/signer-shim/src/policy-fetch.ts:ensureMatch` asserts the root match
on every signing call. `packages/signer-shim/src/sentinel-signer.test.ts`
covers `POLICY_MISMATCH`, `POLICY_REVOKED`, `POLICY_NOT_FOUND` paths.
