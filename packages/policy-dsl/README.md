# @sentinel/policy-dsl

Programmable policy DSL for Solana agent transaction firewalls.

**Parse → Evaluate → Canonicalize** — zero I/O, pure functions, fully deterministic.

## Install

```bash
npm install @sentinel/policy-dsl
```

## Define a policy (YAML)

```yaml
version: 1
agent: AGENTPubKEy11111111111111111111111111111111
caps:
  - token: SOL
    max_per_tx: 1.0
    max_per_day: 5.0
  - token: USDC
    max_per_day: 500
denylist:
  destinations:
    - SCAMaddress111111111111111111111111111111
escalate_above:
  usd_value: 100
rate_limit:
  max_tx_per_minute: 10
```

## Evaluate a transaction

```ts
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { evaluate, parsePolicy, noopHistory } from "@sentinel/policy-dsl";

const policy = parsePolicy(parse(readFileSync("policy.yml", "utf8")));

const verdict = evaluate({
  policy,
  tx: {
    agent: policy.agent,
    token: "SOL",
    amount: 0.5,
    destination: "11111111111111111111111111111111",
    programId: "11111111111111111111111111111111",
    usdValue: 40,
    timestamp: Date.now(),
  },
  history: noopHistory,
  now: Date.now(),
});

// verdict: { type: "allow" }
//       or { type: "deny", reason: "..." }
//       or { type: "escalate", reason: "..." }
```

## On-chain root

Every policy has a deterministic SHA-256 root (RFC 8785 canonical JSON) that's
stored on-chain in the Sentinel registry program:

```ts
import { policyRootHex } from "@sentinel/policy-dsl/canonicalize";

console.log(policyRootHex(policy));
// → "04110a048439680ebd23e68c0d657a76d91f2712e9642764d9c8f5774db36ae2"
```

## Precedence

**Deny > Escalate > Allow** — the strictest applicable rule wins (see ADR 0002).

## API

| Export | Module | Description |
|--------|--------|-------------|
| `parsePolicy(raw)` | `@sentinel/policy-dsl` | Validate & parse a YAML-parsed object |
| `evaluate(ctx)` | `@sentinel/policy-dsl` | Pure verdict evaluation |
| `noopHistory` | `@sentinel/policy-dsl/engine` | Zero-state spend history for stateless checks |
| `policyRoot(policy)` | `@sentinel/policy-dsl/canonicalize` | SHA-256 as `Uint8Array` |
| `policyRootHex(policy)` | `@sentinel/policy-dsl/canonicalize` | SHA-256 as hex string |
| `canonicalJson(policy)` | `@sentinel/policy-dsl/canonicalize` | RFC 8785 canonical JSON |
| `PolicyV1` | `@sentinel/policy-dsl/schema` | Zod schema for validation |

## License

MIT
