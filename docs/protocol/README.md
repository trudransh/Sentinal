# Sentinel Protocol Documentation

> **Sentinel is a programmable policy primitive for Solana agent treasuries.**

This documentation explains the full protocol — how it works, how to integrate it, and how to think about it as a product.

---

## Documentation Index

| Document | What it covers |
|---|---|
| [**How Sentinel Works**](./how-it-works.md) | The problem, the architecture, the trust model — the "explain it to anyone" doc |
| [**Integration Guide**](./integration-guide.md) | Step-by-step: how a developer wraps their agent with Sentinel in 10 minutes |
| [**Policy Reference**](./policy-reference.md) | Every YAML field, every rule type, every edge case — the complete policy DSL spec |
| [**On-Chain Registry**](./registry-spec.md) | The Anchor program: instructions, account layout, events, PDA derivation |
| [**Product Roadmap**](./product-roadmap.md) | From hackathon to product: the pathway to making Sentinel a real business |

### Also see
- [`docs/TRUST_MODEL.md`](../TRUST_MODEL.md) — full threat model + what Sentinel does NOT protect against
- [`docs/squads-owner.md`](../squads-owner.md) — Squads multisig governance deep-dive
- [`examples/policies/`](../../examples/policies/) — small, medium, strict example YAML policies
