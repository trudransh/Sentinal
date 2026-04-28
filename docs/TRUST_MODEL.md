# Sentinel — Trust Model

## What Sentinel actually defends against

A misbehaving or compromised AI agent that has signing authority over a Solana
keypair. Concretely:

1. The agent executable is malicious or has been jailbroken.
2. The agent's logic was correct but its inputs were poisoned (prompt injection,
   compromised tool output, malicious x402 server).
3. The agent's dependencies have been tampered with (supply chain compromise of
   a downstream library it imports).

In all three, the agent will *try* to sign transactions you do not want signed.
The signer-shim is the choke point that refuses on the agent's behalf, before
the bytes ever leave the machine.

## What Sentinel does NOT defend against

- **Physical or root access to the agent host.** A signer with an attacker on
  the box can replace the policy file, the shim binary, or the keypair. Defend
  with OS-level isolation (separate user, Linux namespaces, a separate machine).
- **Compromised RPC or Helius account.** A malicious RPC can lie about the
  on-chain root. The shim checks revoked status and root match, but a colluding
  RPC + tampered local policy bypasses both. **Mitigation:** pin RPC URL,
  monitor `policy_events` for unexpected updates, alert externally.
- **Front-running or MEV.** Sentinel decides "should we sign?" — what happens
  to the tx in the mempool is out of scope.
- **Rug-pull from a counterparty allowlisted in the policy.** If you allow
  `Treasury…`, Sentinel will sign payments there. Choose your allowlist
  carefully.

## The owner-key problem (Auditor blind spot)

The on-chain registry has a single update authority — the **owner** keypair.
Whoever holds that key can:

- Update the agent's policy root (relax limits, add denylist exceptions).
- Revoke the policy entirely (which the shim treats as "stop signing").

If the owner key sits **on the same machine** as the agent and a single
attacker compromises the box, they can both change the policy *and* run the
agent under the relaxed policy. That collapses the firewall to theater.

**Required defense for any production deployment:**

1. **Owner key on hardware.** Ledger or Yubikey with a physical confirmation
   button is the bar. The dashboard's "Approve & update policy" flow MUST go
   through an out-of-band signer.
2. **Owner key on a different operator.** Even with hardware, the operator
   approving the update should not be the same as the operator running the
   agent in production. Two-person rule.
3. **Time-locked updates.** A future improvement: require updates to wait
   N minutes after submission, with an alert webhook on submission. Gives a
   compromised owner key a window in which a watching human can revoke.

For this hackathon submission, we ship a **demo-mode keypair** flow but:

- The dashboard prints a `[DEMO MODE]` banner whenever a software keypair is
  used as owner.
- README explicitly warns that production deployments must use Ledger.
- The wallet-adapter path (B2) supports Phantom + Ledger via Phantom; switching
  the demo to Ledger is a config change, not a code change.

## Defense-in-depth summary

| Threat | Layer that handles it |
|---|---|
| Agent signs unwanted tx | signer-shim refuses (rules + rate-limit + escalate) |
| Local policy diverges from agreed policy | on-chain root mismatch → refuse |
| On-chain policy revoked | revoked flag → refuse |
| Compromised RPC lies | partial — pin RPC, monitor webhook events |
| Owner key on same machine as agent | **document + use Ledger** (not enforced by shim) |
| Token-2022 with confidential transfers | tx-parser rejects with `TOKEN_2022_NOT_SUPPORTED` (D9) |
| Versioned (v0) transactions | tx-parser rejects with `UNSUPPORTED_TX` |
| Webhook payloads from non-Helius source | `HELIUS_WEBHOOK_SECRET` Authorization header (D4) |

## Open spec posture

Sentinel is published MIT (see `LICENSE`). The policy DSL, root-canonicalization,
and registry account layout are intended as **proposals** for an open standard.
If a different signer (Phantom Embedded, Squads, Lit) wants to implement the
same primitive, the on-chain root format and `evaluate(ctx)` contract are
identical — that's the schema-Schelling-point we're trying to seed.
