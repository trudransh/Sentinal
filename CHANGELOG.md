# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Workspace scaffold: pnpm workspace, tsconfig.base, Cargo workspace, Anchor.toml.
- Package skeletons for `policy-dsl`, `signer-shim`, `x402-interceptor`, `zerion-bridge`.
- Program skeleton at `programs/sentinel-registry` with `register_policy` / `update_policy` / `revoke_policy`.
- Example policies (small, medium, strict) under `examples/policies/`.
- `@sentinel/policy-dsl`: zod schema (v1, `.strict`), RFC 8785 canonicalizer + sha256 root, pure-function rule engine with deny>escalate>allow precedence, 25 vitest fixtures green.
- `programs/sentinel-registry`: Anchor 0.32 program with `register_policy` / `update_policy` / `revoke_policy` instructions, `PolicyRecord` PDA (seeds `[b"policy", agent]`, `#[derive(InitSpace)]`, 100-byte `_reserved` buffer), `has_one = owner` constraints, post-revoke update rejection, `PolicyRegistered` / `PolicyUpdated` / `PolicyRevoked` events.
- `tests/sentinel-registry.ts`: full lifecycle Anchor test green on localnet (6 tests: register, update+bump, non-owner rejection, revoke, post-revoke rejection, event emission).
- Workspace Cargo.lock pins to keep SBF cargo 1.84 happy: `proc-macro-crate=3.3.0`, `toml_datetime=0.6.11`, `toml_edit=0.22.27`, `indexmap=2.10.0`, `unicode-segmentation=1.12.0`.
- `@sentinel/signer-shim`: `SentinelSigner` (web3.js Signer-compatible), `tx-parser` (System+SPL Token, v0 rejection, mint-decimals cache), `price-oracle` (Pyth Hermes pull, 60s stale rule, USDC peg sanity check), `policy-fetch` (on-chain root compare, 30s TTL, log-subscription cache invalidation), `rate-limiter` (better-sqlite3 sliding window, in-memory variant for tests). 30 vitest fixtures green across 5 test files.

### Changed
- Anchor.toml `[scripts] test` switched from `pnpm vitest run --dir tests` (Implementation.md §2.2) to `ts-mocha` to match the test file shape in §6.2 (uses `chai` + `before`). Per §2.6 (`anchor test` uses Mocha by default).
