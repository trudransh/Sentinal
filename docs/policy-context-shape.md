# Zerion `ctx` shape (probed)

> **Status: PLACEHOLDER.** Replace with the *actual* JSON dumped by `~/.config/zerion/policies/sentinel-probe.mjs` (Implementation.md P0.T4) before integrating the bridge.

The probe writes one JSON file per call to `~/.sentinel-probe/ctx-<ts>.json`. Capture three:
1. A simple SOL transfer.
2. An SPL-token transfer.
3. A swap (multi-instruction).

Then update the schema below to match what was actually observed.

## Tentative schema (until probe runs)

```ts
interface ZerionCtx {
  transaction: {
    chain: string;     // CAIP-2 (e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") — confirm format
    from: string;
    to?: string;
    data?: string;     // hex-encoded serialized tx for Solana?
    value?: string;
  };
  policy_config?: {
    scripts?: string[];
    [k: string]: unknown;
  };
  // ...
}
```

## What the adapter (`packages/zerion-bridge/src/adapter.ts`) needs

- `chain` discriminator → return null for non-Solana.
- A path to a serialized Solana transaction we can deserialize via `Transaction.from(bytes)` so the same `tx-parser` can run on it.
- Owner / agent identity, if present, for logging.
