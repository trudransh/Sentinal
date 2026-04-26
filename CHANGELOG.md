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

### Changed
- Anchor.toml `[scripts] test` switched from `pnpm vitest run --dir tests` (Implementation.md §2.2) to `ts-mocha` to match the test file shape in §6.2 (uses `chai` + `before`). Per §2.6 (`anchor test` uses Mocha by default).
