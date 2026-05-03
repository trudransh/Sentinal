# Zerion `ctx` shape — captured

> **Status: REAL.** Captured 2026-05-02 → 2026-05-03 from live `zerion` CLI
> runs against the bundled policy dispatcher (`run-policies.mjs`). Two
> shapes captured below; a third (full serialized Solana tx with calldata)
> was **not capturable** with this CLI build — see *Limitation* at bottom.

## Capture provenance

| File | Command | Bytes | What it is |
|---|---|---|---|
| `/tmp/sentinel-zerion-ctx.json` | `zerion sign-message sentinel-probe-test --chain ethereum --wallet sentinelbot --pretty` | 502 | Sign-message ctx (rich runtime metadata) |
| `/tmp/sentinel-zerion-ctx-swap.json` | `zerion swap USDC ETH 2 --chain base --wallet sentinelbot --pretty` | 236 | Swap pre-assembly stub (policy fires before route assembly) |

Both runs were via `pnpm probe:zerion` with `ZERION_GLOBAL=1` after the
`ZERION_ISOLATED=1` mode hit `policy_path_violation` (Zerion validates the
policy script path against the canonical global install location).

The probe denied each tx with the expected `policy_denied` / `Blocked by
policy` response, so neither broadcast.

## Shape 1 — sign-message (rich)

```json
{
  "api_key_id": "fbd6a603-b1e0-455f-9ad7-806ff8a8a9ee",
  "chain_id": "eip155:1",
  "policy_config": {
    "scripts": [
      "/home/dracian/.nvm/versions/node/v24.11.0/lib/node_modules/zerion-cli/cli/policies/deny-transfers.mjs"
    ]
  },
  "spending": { "daily_total": "0", "date": "2026-05-02" },
  "timestamp": "2026-05-02T22:05:05.888061251+00:00",
  "transaction": { "raw_hex": "73656e74696e656c2d70726f62652d74657374" },
  "wallet_id": "b8831b51-4135-4de2-b4f6-3ad0ee902638"
}
```

`raw_hex` decodes to ASCII `"sentinel-probe-test"` — the literal message we
passed. Sign-message is **not** a tx broadcast; the probe receives a hex
encoding of the message, not a serialized Solana `Transaction`.

## Shape 2 — swap pre-assembly stub

```json
{
  "transaction": { "to": null, "value": "0", "data": "0x" },
  "policy_config": {
    "scripts": [
      "/home/dracian/.nvm/versions/node/v24.11.0/lib/node_modules/zerion-cli/cli/policies/deny-transfers.mjs"
    ]
  }
}
```

`to: null`, `value: "0"`, `data: "0x"` — the policy is invoked **before**
Zerion assembles route calldata. We never see the actual swap instructions.

## Field-by-field schema

| Field | Type | Always present? | Notes |
|---|---|---|---|
| `chain_id` | string (CAIP-2) | When known | `"eip155:1"`, `"eip155:8453"` (Base), `"solana:<genesis>"`. **Top-level**, not under `transaction`. |
| `api_key_id` | string (uuid) | Sign-message yes; swap stub no | The Zerion API key id used. **Sensitive — redact in screenshots.** |
| `wallet_id` | string (uuid) | Sign-message yes; swap stub no | Internal Zerion wallet id (not the pubkey). **Sensitive.** |
| `timestamp` | string (ISO-8601 + ns) | Sign-message yes | RFC 3339 with nanosecond precision. |
| `spending` | `{ daily_total: string, date: string }` | Sign-message yes | Daily-rollup snapshot; `daily_total` is a stringified BigInt-ish. |
| `policy_config.scripts` | string[] | Always | Absolute paths to the loaded policy scripts. |
| `transaction.raw_hex` | string (hex) | Sign-message only | Hex of the message body. **Not** a serialized Solana tx. |
| `transaction.data` | string (hex w/ 0x) | Trade flows | `"0x"` on the swap pre-assembly stub. Real calldata not observed in this CLI build. |
| `transaction.to` | string \| null | Trade flows | `null` on stub. |
| `transaction.value` | string (wei/lamports) | Trade flows | `"0"` on stub. |
| `transaction.from` | string | Rare | Not present in either capture; included in adapter type for future-proofing. |

## Adapter implementation (`packages/zerion-bridge/src/adapter.ts`)

Decision rules in order:

1. `chain_id` not Solana (CAIP-2 prefix `solana:` or substring fallback) →
   return `null`. Bridge defers to Zerion's own EVM rules.
2. No `transaction` field → return `[]`. Bridge denies on empty.
3. `transaction.raw_hex` set with no `data` → return `[]` (sign-message,
   not a tx).
4. `transaction.data` is `"0x"` / empty / missing → return `[]` (Zerion
   stub before route assembly).
5. `transaction.data` is parseable hex/base64 → decode via
   `Transaction.from(...)` and emit one `TxSummary` per instruction.

The bridge's `sentinel.mjs` `check(ctx)` treats `summaries.length === 0`
as deny, so Zerion's pre-assembly swap stub becomes a denied tx in our
defense posture. This is conservative-by-default — Sentinel cannot reason
about a swap whose calldata it cannot see.

## Limitation: Zerion's pre-assembly policy hook

The dispatcher (`run-policies.mjs`) is invoked by the CLI **before** the
swap route is built. That's why `transaction.data === "0x"` for the swap
capture even on a real `zerion swap USDC ETH 2` command. Implications:

- **Sentinel's signer-shim path** (autonomous Solana agents calling
  `web3.js.signTransaction`) sees fully assembled txs — full enforcement.
- **Sentinel's Zerion-bridge path** (Zerion CLI agents) sees the
  pre-assembly stub — we can only enforce on `chain_id` + sign-message,
  and deny opaque trade flows.

For richer Zerion enforcement, the post-broadcast path is Zerion's
**transaction subscription webhooks** (documented at
<https://developers.zerion.io>). That's a post-mortem signal, not a
pre-broadcast veto, but it lets the dashboard show what Zerion actually
broadcasted for an agent.

## What the bridge guarantees today

| Zerion command | What we see | What we enforce |
|---|---|---|
| `sign-message` (Solana) | hex-encoded message | Empty summaries → deny (conservative; sign-message isn't gated by tx policy in our model) |
| `swap` / `bridge` (Solana) | pre-assembly stub | Empty summaries → deny |
| `send` (Solana) | not capturable on this CLI build (`zerion send` is EVM-only) | n/a |
| `sign-message` (EVM) | rich ctx, `chain_id: eip155:*` | Defer to Zerion's own EVM rules → `null` |
| `swap` / `bridge` / `send` (EVM) | rich ctx (similar shape), `chain_id: eip155:*` | Defer to Zerion's own EVM rules → `null` |

This matches Sentinel's MVP scope (Solana only). EVM is post-hackathon.
