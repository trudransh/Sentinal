# @sentinel/policy-dsl — Standalone Embed

Drop Sentinel's policy engine into **any** TypeScript/Node project in under 5 lines.

## Install

```bash
npm install @sentinel/policy-dsl yaml
```

## Quick start

```ts
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { evaluate, parsePolicy, noopHistory } from "@sentinel/policy-dsl";

const policy = parsePolicy(parseYaml(readFileSync("policy.yml", "utf8")));
const verdict = evaluate({ policy, tx: myTxSummary, history: noopHistory, now: Date.now() });

if (verdict.type === "deny") throw new Error(verdict.reason);
if (verdict.type === "escalate") await notifyOwner(verdict.reason);
```

## What you get

| Export | Purpose |
|--------|---------|
| `parsePolicy(raw)` | Validates YAML-parsed object against the v1 schema (zod). Throws `InvalidPolicyError` with structured issues. |
| `evaluate(ctx)` | Pure function: `(policy, tx, history, now) → allow \| deny \| escalate`. No I/O, no side-effects. |
| `policyRoot(policy)` | SHA-256 of RFC 8785 canonical JSON — the on-chain root stored in the Sentinel registry. |
| `noopHistory` | Zero-state spend history — useful for stateless evaluation or tests. |

## Run the full example

```bash
cd /path/to/Sentinal
npx tsx examples/embed/evaluate.ts
```

## Use with the full stack

The same policy YAML that works here also governs:
- **signer-shim** — autonomous agent transaction signing
- **zerion-bridge** — Zerion wallet policy enforcement
- **x402-interceptor** — HTTP 402 payment gating
- **dashboard** — owner approval & live monitoring
