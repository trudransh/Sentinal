# Demo video script — 3 minutes, no live coding

Per Implementation.md §11.1. Record once, watch back, time it. If a beat overruns by > 10s, cut narration before re-recording.

## Pre-flight

Open three terminals + one browser tab:

| Terminal | Process |
|---|---|
| T1 | `pnpm -F @sentinel/app dev` (dashboard) |
| T2 | `pnpm -F @sentinel/x402-interceptor demo:server` |
| T3 | demo client runner — runs `pnpm -F @sentinel/x402-interceptor demo:client` on demand |
| Browser | http://localhost:3000 |

Have these files ready in adjacent windows: `examples/policies/medium.yml`, `programs/sentinel-registry/src/lib.rs`.

## Frame-by-frame

### 0:00 – 0:20 — Hook

**Screen:** terminal showing a malicious agent draining a wallet.

**Narration:** "Every Solana agent today holds a god-mode key. When the model hallucinates, when the process is compromised, when the prompt gets injected — there's nothing standing between bad logic and the chain. This is what that looks like." [Show a tx that drains the wallet.]

### 0:20 – 0:50 — Setup Sentinel

**Screen:** terminal + `cat sentinel.yml` showing a 12-line YAML; then a single command to register.

**Narration:** "One YAML, one on-chain register. Caps, allowlists, programs, USD escalation, rate limits. The hash of this YAML lives on-chain as the only identity bind between what's on disk and what's authorized."

```bash
cat examples/policies/medium.yml
sentinel deploy   # placeholder — show register_policy via Anchor client
```

### 0:50 – 1:10 — Wrap the signer

**Screen:** one diff line in the agent code.

**Narration:** "Wrap your existing keypair. That's the integration. The signer shim refuses to sign if local YAML and on-chain root disagree, and refuses anything outside the policy."

```ts
- const signer = keypair;
+ const signer = new SentinelSigner({ policyPath, agentKeypair: keypair, /* ... */ });
```

### 1:10 – 1:40 — Cheap call (allow path)

**Screen:** terminal runs the demo client; dashboard shows the event.

**Narration:** "/cheap costs 0.001 USDC. Under the medium policy this auto-approves. One round trip, signed, settled, dashboard updates."

```bash
pnpm -F @sentinel/x402-interceptor demo:client   # /cheap → 200
```

### 1:40 – 2:10 — Expensive call (escalate path)

**Screen:** demo client requests `/expensive`; modal appears in the dashboard; click *Approve*; client receives 200.

**Narration:** "/expensive costs 5 USDC. The escalate-above threshold catches it. The agent doesn't sign — instead, an approval ticket lands here. We approve manually, the tx flows."

### 2:10 – 2:30 — Blocked call (deny path)

**Screen:** demo client requests `/blocked`; client throws `PaymentDeniedError`; dashboard shows the deny.

**Narration:** "/blocked has a destination on the agent's denylist. The signer refuses; the dashboard shows the deny in red. Note: this isn't a server-side block — it happens on the agent's side, before the key is even touched."

### 2:30 – 2:50 — Tour: dashboard + on-chain registry

**Screen:** scroll dashboard panels; then `solana account <pda>` printout.

**Narration:** "Dashboard: live activity from Helius webhooks, escalation queue, balance widget over Dune SIM, Monaco YAML editor with on-the-fly canonicalization. On-chain: a single PDA per agent — owner, agent, root, version, revoked. Three instructions. Three events."

### 2:50 – 3:00 — Sponsor logos + thanks

Static slide. Zerion ×2, Dune SIM, Helius/RPC Fast, 100xDevs, Adevar/Eitherway, Superteam India.
