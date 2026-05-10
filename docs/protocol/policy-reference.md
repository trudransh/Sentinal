# Policy Reference

> **Complete specification of the Sentinel Policy DSL.**

The policy DSL defines what an agent is allowed to do. Policies are written in YAML and validated against a Zod schema at load time.

---

## Policy Structure

```yaml
version: 1                    # Required. Always 1 for now.
agent: <base58-pubkey>         # Required. The agent's Solana public key.

caps:                          # Optional. Spending limits per token.
  - token: <symbol>
    max_per_tx: <number>       # Max amount per single transaction
    max_per_day: <number>      # Max amount per rolling 24-hour window
    max_per_hour: <number>     # Max amount per rolling 1-hour window

allowlist:                     # Optional. Only these destinations can receive.
  destinations:
    - <base58-pubkey>
    - <base58-pubkey>

denylist:                      # Optional. These destinations are always blocked.
  destinations:
    - <base58-pubkey>

programs:                      # Optional. Program invocation filters.
  allow:                       # Only these programs may be called.
    - <base58-program-id>
  deny:                        # These programs are always blocked.
    - <base58-program-id>

rate_limit:                    # Optional. Transaction frequency limits.
  max_tx_per_minute: <number>

escalate_above:                # Optional. USD-value escalation threshold.
  usd_value: <number>         # Anything above this USD value → human queue
```

---

## Field Reference

### `version` (required)
- **Type:** `number`
- **Valid values:** `1`
- **Purpose:** Schema versioning. Future protocol upgrades will increment this.

### `agent` (required)
- **Type:** `string` (base58-encoded Solana public key)
- **Purpose:** Identifies which agent this policy governs. Must match the agent keypair the `SentinelSigner` wraps.

### `caps` (optional)
- **Type:** Array of spending cap objects
- **Purpose:** Limits how much the agent can spend per token

Each cap object:

| Field | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | Token symbol (`SOL`, `USDC`, `USDT`, etc.) |
| `max_per_tx` | number | No | Maximum amount in a single transaction |
| `max_per_day` | number | No | Maximum cumulative amount in a rolling 24-hour window |
| `max_per_hour` | number | No | Maximum cumulative amount in a rolling 1-hour window |

**How rolling windows work:** The shim maintains a SQLite-backed sliding window of recent transactions. When evaluating `max_per_day`, it sums all transactions for that token in the last 86400 seconds. The window is monotonic — counters are never decremented.

**Token matching:** The `token` field matches against the SPL token symbol. For native SOL, use `SOL`. The match is case-insensitive.

### `allowlist` (optional)
- **Purpose:** Whitelists specific destination addresses

```yaml
allowlist:
  destinations:
    - DexRouter11111111111111111111111111111111111
    - Treasury111111111111111111111111111111111111
```

If `allowlist` is present, **only** the listed addresses can receive funds. Any transfer to an unlisted address is denied.

If `allowlist` is absent, all destinations are allowed (unless blocked by `denylist`).

### `denylist` (optional)
- **Purpose:** Blacklists specific destination addresses

```yaml
denylist:
  destinations:
    - KnownScam1111111111111111111111111111111111
```

Any transfer to a denylisted address is **always denied**, regardless of other rules.

**Precedence:** `denylist` overrides `allowlist`. If an address appears in both, it's denied.

### `programs` (optional)
- **Purpose:** Controls which Solana programs the agent can invoke

```yaml
programs:
  allow:
    - TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA  # SPL Token
    - 11111111111111111111111111111111                 # System Program
  deny:
    - SuspiciousProgram111111111111111111111111111
```

If `programs.allow` is present, only listed programs can be invoked. If `programs.deny` is present, listed programs are always blocked. `deny` overrides `allow`.

### `rate_limit` (optional)
- **Purpose:** Limits transaction frequency

```yaml
rate_limit:
  max_tx_per_minute: 6
```

The shim tracks transaction timestamps in a sliding 60-second window. If the agent exceeds this count, the transaction is denied with `RATE_LIMIT`.

### `escalate_above` (optional)
- **Purpose:** Routes high-value transactions to human approval

```yaml
escalate_above:
  usd_value: 50
```

For any transaction where the estimated USD value exceeds the threshold, the shim:
1. Does **not** sign immediately
2. Inserts the tx into the escalation queue (SQLite)
3. Streams it to the dashboard via SSE
4. Waits for human approval/rejection

**USD pricing:** Uses Pyth Hermes pull oracle to fetch current SOL/USD price. If the price is stale (>60 seconds old), the transaction is auto-escalated as a safety measure.

---

## Rule Precedence

```
Deny > Escalate > Allow
```

1. If **any** rule produces a `DENY` verdict → transaction is refused
2. If no deny, but **any** rule produces an `ESCALATE` verdict → transaction goes to human queue
3. If all rules pass → transaction is signed

Rules are evaluated in this order:
1. Denylist check (destination)
2. Program deny check
3. Allowlist check (destination)
4. Program allow check
5. Cap checks (per-tx, per-day, per-hour)
6. Rate limit check
7. USD escalation check

---

## Root Computation

The policy root is a SHA-256 hash of the policy's canonical representation:

```
1. Parse YAML → JavaScript object
2. Canonicalize via RFC 8785 (JCS — JSON Canonicalization Scheme)
3. SHA-256 hash → 32 bytes → hex string
```

```typescript
import { policyRootHex } from "@sentinel/policy-dsl";
import { parse } from "yaml";

const root = policyRootHex(parse(yamlString));
// Returns: "a1b2c3d4..." (64-character hex string)
```

**Why RFC 8785?** Different YAML parsers can produce different JSON key orderings. RFC 8785 canonicalization ensures the same policy always produces the same hash, regardless of parser, platform, or key order.

---

## Example Policies

### Minimal (testing)
```yaml
version: 1
agent: <your-agent>
caps:
  - token: SOL
    max_per_day: 0.5
```

### Standard (production agent)
```yaml
version: 1
agent: <your-agent>
caps:
  - token: USDC
    max_per_tx: 10
    max_per_day: 50
  - token: SOL
    max_per_tx: 0.5
allowlist:
  destinations:
    - <treasury>
    - <dex-router>
rate_limit:
  max_tx_per_minute: 6
```

### Strict (high-value treasury)
```yaml
version: 1
agent: <your-agent>
caps:
  - token: SOL
    max_per_day: 0.0001
  - token: USDC
    max_per_day: 5
allowlist:
  destinations:
    - <single-treasury>
programs:
  allow:
    - TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    - 11111111111111111111111111111111
escalate_above:
  usd_value: 1
rate_limit:
  max_tx_per_minute: 2
```

---

## Validation Errors

When a policy fails schema validation (via Zod), the error messages are:

| Error | Cause |
|---|---|
| `version is required` | Missing `version` field |
| `agent is required` | Missing `agent` field |
| `Invalid token symbol` | `caps[].token` is empty or not a string |
| `max_per_tx must be positive` | Cap amount is zero or negative |
| `Invalid public key` | An address in allowlist/denylist is not valid base58 |
