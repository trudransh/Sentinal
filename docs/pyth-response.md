# Pyth Hermes response (probed)

> **Status: PLACEHOLDER.** Replace with the actual response body returned by `HermesClient.getLatestPriceUpdates([feedIds])` once Phase 3 runs the oracle.

## Tentative shape (per Pyth docs, verify on first call)

```ts
interface HermesResponse {
  binary: { encoding: "hex" | "base64"; data: string[] };
  parsed: Array<{
    id: string;             // hex feed ID
    price: {
      price: string;        // integer as string (apply expo)
      conf: string;
      expo: number;         // negative; e.g. -8 for 8 decimals
      publish_time: number; // unix seconds
    };
    ema_price: { price: string; conf: string; expo: number; publish_time: number };
    metadata: { slot?: number; proof_available_time?: number; prev_publish_time?: number };
  }>;
}
```

## Feed IDs we use

| Symbol | Feed ID | Notes |
|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | mainnet ID; same Hermes endpoint serves devnet |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | Sanity-checked on first call: must be within 0.95–1.05 |

> **Confirm on first run** that the feed IDs above resolve. Pyth occasionally rotates feed IDs across major upgrades.

## Stale rule

If `now - publish_time*1000 >= 60_000`, treat the price as stale and return `Number.POSITIVE_INFINITY` for USD value. The engine will escalate.
