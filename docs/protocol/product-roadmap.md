# Product Roadmap: From Hackathon to Product

> **How Sentinel becomes a real business — and how anyone can use it for their agents.**

---

## The Product Vision

**Sentinel is the "firewall for AI agent wallets."**

Every Solana AI agent — whether it's trading, managing yield, processing payments, or interacting with DeFi — needs spending controls. Today, each team builds their own ad-hoc guardrails (or more commonly, doesn't). Sentinel makes it a one-line integration.

---

## Who Uses Sentinel

### Primary Users: Agent Builders
Developers building autonomous Solana agents who need:
- Spending limits so a bug can't drain the treasury
- Human-in-the-loop for high-value transactions
- Audit trail for compliance
- Multi-sig governance for shared agent wallets

### Secondary Users: Agent Operators
Non-technical operators who deploy agents and need:
- A dashboard to monitor what their agent is doing
- The ability to approve/reject escalated transactions
- Policy editing without touching code

### Tertiary Users: Protocol/DAO Treasuries
DAOs that delegate spending authority to AI agents but need:
- Squads multisig governance over policy changes
- On-chain proof of what policy was active when a tx was signed
- Revocation capability if an agent misbehaves

---

## Current State (Hackathon)

What's built and working today:

| Component | Status | Notes |
|---|---|---|
| Policy DSL (YAML → hash) | ✅ Production-ready | 45 tests, Zod schema, RFC 8785 canonicalization |
| On-chain registry | ✅ Deployed on devnet | 6 Anchor tests, 3 instructions, event emission |
| Signer shim | ✅ Working | Drop-in Signer replacement, Pyth oracle, rate limiting |
| Dashboard | ✅ Working | SSE live feed, escalation queue, policy editor, balances |
| Zerion bridge | ✅ Working | Real ctx captured, swap denied live |
| x402 interceptor | ✅ Working | Real devnet payment flow |
| Squads multisig owner | ✅ Working | Vault PDA as owner, threshold governance |
| Tests | ✅ 111 passing | 105 vitest + 6 Anchor |

---

## Phase 1: Developer SDK (Month 1-2)

**Goal:** Make it dead-simple for any Solana agent builder to integrate Sentinel.

### What to build:
1. **`npx create-sentinel` CLI**
   - Interactive setup: asks for agent pubkey, desired limits, and generates a `policy.yml`
   - Auto-registers the policy on devnet
   - Generates the integration code snippet

2. **npm package polish**
   - Publish `@sentinel/signer-shim` and `@sentinel/policy-dsl` to npm
   - TypeScript declarations, JSDoc, README with copy-paste examples
   - Zero-config mode: `SentinelSigner.fromEnv()` reads everything from env vars

3. **SDK for popular agent frameworks**
   - **ElizaOS adapter**: Drop-in plugin that wraps Eliza's wallet provider
   - **LangChain tool wrapper**: Sentinel as a LangChain tool gate
   - **Rig adapter**: For the Rig framework's wallet integration
   - **CrewAI/AutoGen**: Python SDK bridge via subprocess or WASM

4. **Documentation site**
   - GitBook or Docusaurus hosted at `docs.sentinel.dev`
   - Interactive policy playground (paste YAML → see root hash → simulate tx)
   - API reference auto-generated from TypeScript types

### Success metric:
A developer can go from `npm install` to a policy-gated agent in under 10 minutes, with no knowledge of Sentinel internals.

---

## Phase 2: Hosted Dashboard (Month 2-4)

**Goal:** Non-technical operators can monitor and manage agent policies without running code.

### What to build:
1. **Multi-tenant dashboard**
   - Login with Solana wallet (Phantom, Solflare)
   - Each user sees only their agents' activity
   - Policy editing via web UI (no YAML knowledge needed — form builder)

2. **Policy template marketplace**
   - Pre-built templates: "DeFi Trading Agent", "Payment Processor", "NFT Minter"
   - Community-submitted templates with ratings
   - One-click deploy

3. **Alerting and notifications**
   - Telegram/Discord/Slack bot for escalation notifications
   - Email alerts for policy violations
   - Webhook integration for custom alerting

4. **API access**
   - REST API for programmatic policy management
   - Webhook callbacks for events (policy updated, tx denied, escalation created)

### Business model:
- **Free tier:** 1 agent, basic dashboard, community support
- **Pro ($49/mo):** Unlimited agents, alerts, API access, priority support
- **Enterprise ($299/mo):** Custom policies, dedicated support, SLA, audit logs

---

## Phase 3: Advanced Policy Engine (Month 4-6)

**Goal:** Handle the long tail of agent use cases with sophisticated rules.

### What to build:
1. **Conditional policies**
   ```yaml
   rules:
     - if:
         time_of_day: [09:00, 17:00]   # business hours only
         day_of_week: [mon, tue, wed, thu, fri]
       then:
         max_per_tx: 100
     - else:
         max_per_tx: 10   # off-hours: strict limits
   ```

2. **Multi-agent policies**
   - Global limits across multiple agents sharing a treasury
   - Agent-to-agent transfer rules
   - Hierarchical policies (org → team → agent)

3. **Dynamic allowlists**
   - Oracle-backed allowlists (e.g., "only verified programs on the Solana Program Registry")
   - Time-expiring allowlist entries
   - Approval-gated additions

4. **ML anomaly detection**
   - Train on normal agent behavior patterns
   - Flag statistical anomalies even within policy limits
   - "This agent usually sends 5 txs/hour but just sent 50 — escalate?"

5. **Versioned transaction support**
   - Parse v0 transactions (address lookup tables)
   - Token-2022 extension handling

---

## Phase 4: Protocol Layer (Month 6-12)

**Goal:** Sentinel becomes an open protocol, not just a product.

### What to build:
1. **Mainnet deployment**
   - Security audit (Sec3, OtterSec, or Neodyme)
   - Program upgrade authority transferred to a governance multisig
   - Formal verification of critical invariants

2. **Policy marketplace protocol**
   - On-chain policy templates as NFTs
   - Audited policy patterns with formal proofs
   - Composable policy modules (import a "DeFi safety" module into your policy)

3. **Cross-signer compatibility**
   - Any signer implementation can check the on-chain root
   - Phantom Embedded integration (policy check in-wallet)
   - Squads native integration (policy as a Squads-native feature)

4. **Governance token (optional)**
   - Only if there's a real utility (policy curation, dispute resolution, audit bounties)
   - Not a speculative play — token must have clear value accrual

---

## Competitive Landscape

| Competitor | What they do | How Sentinel differs |
|---|---|---|
| **Mercantill** (Cypherpunk 4th) | Spend control + multisig + audit as one product | Sentinel composes with Squads instead of duplicating governance |
| **Lit Protocol** | MPC + programmable signing | Sentinel is simpler — local rule evaluation, no MPC complexity |
| **Turnkey** | Key management + policy engine | Web2-native, not Solana-first |
| **Raw keypair** | The status quo | No policy, no limits, no audit trail |

**Sentinel's moat:** The on-chain root binding. Other solutions do policy evaluation off-chain only — Sentinel proves on-chain which policy was active, creating an immutable audit trail.

---

## Go-to-Market

### Phase 1: Hackathon → Developer Community
- Win or place at Colosseum Frontier
- Open-source everything (MIT)
- Write integration guides for the top 5 Solana agent frameworks
- Ship blog posts: "Why your AI agent needs a firewall"

### Phase 2: Design Partners
- Partner with 3-5 agent builders to integrate Sentinel
- Offer free Pro tier for 6 months in exchange for feedback + case studies
- Co-market: "Built with Sentinel" badge

### Phase 3: Self-Serve
- Launch hosted dashboard
- Content marketing: tutorials, case studies, comparisons
- Developer advocate hires

### Phase 4: Enterprise
- Direct sales to DAOs and protocols with AI agent strategies
- Custom policy consulting
- Audit report generation for compliance

---

## Key Decisions to Make Now

1. **Hosted vs. self-hosted?** Start self-hosted (current state). Add hosted option in Phase 2. Never force it — self-hosted is always an option.

2. **Token or no token?** Not yet. Build product-market fit first. A token without real utility is a distraction.

3. **Which agent frameworks first?** ElizaOS and LangChain have the largest Solana agent communities. Start there.

4. **Mainnet timeline?** After a security audit. Estimated Month 6. Devnet is fine for development and demos.

5. **Pricing?** Freemium. The SDK is always free and open-source. The hosted dashboard is the monetization layer.

---

## The One-Liner Pitch

**"Sentinel is a policy engine for Solana AI agents — define spending limits in YAML, and your agent can't exceed them. The policy hash lives on-chain, so even a compromised agent can't bypass it."**

For investors:
**"Every AI agent on Solana needs spending controls. Sentinel is the open standard for agent policy — like how OpenZeppelin became the standard for smart contract security patterns. One-line integration, on-chain audit trail, multi-sig governance built in."**
