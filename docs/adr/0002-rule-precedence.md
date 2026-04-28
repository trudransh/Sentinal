# ADR 0002 — Rule precedence: Deny > Escalate > Allow

| | |
|---|---|
| Status | Accepted |
| Date | 2026-04-28 |
| Driver | Phase 1 (DSL + engine) |

## Context

Policies have multiple rule families: denylist, programs.allow, allowlist,
caps, rate_limit, escalate_above. Two transactions can match more than one
family. We need a deterministic answer for "what is the verdict?"

## Decision

Strict total order: **Deny > Escalate > Allow**.

Pseudocode:
```
verdicts := evaluate every rule against the tx
if any verdict == Deny → return Deny (with the first matching reason)
if any verdict == Escalate → return Escalate (collected reasons)
return Allow
```

Within Deny, the order of family evaluation is:
**denylist → programs.allow miss → allowlist miss → caps overrun → rate_limit overrun**

Within Escalate, the only family is `escalate_above` (USD value via Pyth).

## Consequences

**Positive**
- Deterministic and trivial to test (`policy-dsl/src/engine.test.ts` has 25 fixtures)
- Operators can read a YAML and predict the outcome without simulating
- No "permissive override" foot-gun — once a deny rule matches, no later allow
  rule can rescue it

**Negative**
- Cannot express "deny except for X" — operators must restructure rules.
  In practice this hasn't bitten us; the DSL is small enough to refactor.

## Alternatives rejected

- **First-match wins**: would let operators put a single broad allow ahead of
  denylists by accident, with security consequences. Rejected.
- **Permissive (any allow → allow)**: same problem, plus loses the deny
  signal entirely.
- **Score-based**: harder to reason about, harder to audit. Rejected.

## Verification

`packages/policy-dsl/src/engine.test.ts` includes precedence fixtures (deny
beats escalate; escalate beats allow; deny via denylist beats deny via cap).
The signer-shim integration test (`sentinel-signer.test.ts`) confirms the
verdict surfaces as `POLICY_VIOLATION` (deny) or `ESCALATION_REQUIRED`
(escalate) with the original reason chain attached.
