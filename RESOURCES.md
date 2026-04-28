# Resources

Verified package versions, sponsor URLs, probed schemas, and SCREAMING_SNAKE_CASE error codes.
This file is the source of truth for facts that the docs would otherwise lie about.

## Toolchain (verified against `--version` on this machine)

| Tool | Version |
|---|---|
| Rust | 1.93.0 |
| Anchor CLI | 0.32.1 |
| Solana CLI (Agave) | 3.0.13 |
| Node | 24.11.0 |
| pnpm | 10.20.0 |

## Locked package pins

| Package | Pin | Reason |
|---|---|---|
| `@solana/web3.js` | `^1.95` | Anchor 0.32 TS client expects v1, not `@solana/kit` |
| `@coral-xyz/anchor` | `^0.32` | matches CLI |
| `@solana/spl-token` | `^0.4` | for `decodeTransferCheckedInstruction` |
| `@pythnetwork/hermes-client` | `^1` | off-chain pull oracle |
| `better-sqlite3` | `^11` | sync API for rate-limit + escalations |
| `yaml` | `^2.5` | preferred over js-yaml |
| `zod` | `^3.23` | runtime schema validation |
| `vitest` | `^1.6` | TS test runner |

## Error codes (extend here when adding new codes)

| Code | Where | When |
|---|---|---|
| `POLICY_MISMATCH` | signer-shim | local hash != on-chain root |
| `POLICY_VIOLATION` | engine | rule engine returned `Deny` |
| `POLICY_REVOKED` | signer-shim | `record.revoked == true` |
| `POLICY_NOT_FOUND` | signer-shim | PDA does not exist |
| `RATE_LIMITED` | engine | sliding-window count exceeded |
| `UNSUPPORTED_TX` | tx-parser | versioned tx, empty ix list, unknown program |
| `ORACLE_UNAVAILABLE` | price-oracle | Hermes >= 60s old or non-200 |
| `REGISTRY_FETCH_FAILED` | signer-shim | RPC error reading PDA |
| `WEBHOOK_AUTH_FAILED` | dashboard | Helius webhook missing/wrong Authorization |
| `INVALID_POLICY` | schema | YAML or zod parse fail |
| `ESCALATION_REQUIRED` | signer-shim | engine returned `escalate`; ticket enqueued |
| `TOKEN_2022_NOT_SUPPORTED` | tx-parser | tx contains a Token-2022 instruction (D9) |

## Probed shapes (filled by probes — do not invent)

- `docs/policy-context-shape.md` — Zerion `ctx` (P0.T4)
- `docs/helius-payload.md` — Helius webhook body (Phase 5)
- `docs/pyth-response.md` — Hermes `getLatestPriceUpdates` shape (Phase 3)
- `docs/x402-payload.md` — chosen x402 SDK request/response (Phase 4)

## Cargo.lock SBF pins (D7)

These pins exist because the Solana SBF toolchain bundles cargo 1.84, which
cannot parse `edition2024` declarations from newer transitive deps. They are
**not arbitrary**; they target the following toolchain combination, and must
be re-evaluated on any toolchain bump:

- Anchor CLI **0.32.1**
- Solana CLI (Agave) **3.0.13**
- Bundled SBF cargo: **1.84** (do not upgrade independently)

Pinned crates:

| Crate | Pin | Why |
|---|---|---|
| `proc-macro-crate` | `3.3.0` | `3.5+` requires edition2024 |
| `toml_datetime` | `0.6.11` | newer pulls edition2024 |
| `toml_edit` | `0.22.27` | aligns with `proc-macro-crate` lock |
| `indexmap` | `2.10.0` | newer pulls `unicode-ident` w/ edition2024 |
| `unicode-segmentation` | `1.12.0` | downstream of `proc-macro-crate` |

If `anchor build` breaks with `feature edition2024 is required`, **first**
check whether the toolchain has changed. Re-pin only after confirming the
bundled cargo version, **not** to silence the error blindly.

## Sponsor URLs (verify on submission day)

- Zerion docs: https://docs.zerion.io/
- Helius dashboard: https://dev.helius.xyz
- Dune SIM docs: https://docs.sim.dune.com/
- x402 spec: https://www.x402.org/
- Pyth Hermes: https://hermes.pyth.network
- Pyth feed IDs: https://pyth.network/developers/price-feed-ids
