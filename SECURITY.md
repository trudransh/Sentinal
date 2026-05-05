# Sentinel — Security Posture

This document covers (a) the threat model, (b) reporting channel, (c) the
hardening posture applied at each layer, and (d) the residual CVE
landscape with explicit reasoning for each item.

For a longer treatment of the trust assumptions, see
[`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md).

## Reporting a vulnerability

Email `security@sentinel-policy.dev` (placeholder — replace with the
maintainer's address before publishing). Use PGP if you have a key
listed in the maintainer's GitHub profile. Coordinated disclosure
preferred; we'll respond within 72h.

## Threat model summary

Sentinel defends against a **misbehaving or compromised AI agent** that has
signing authority over a Solana keypair on the same machine. The signer-shim
is the choke point that refuses on the agent's behalf before bytes leave the
box. **Out-of-scope:** root access to the host, compromised RPC, MEV /
front-running, rug-pulls by a counterparty allowlisted in the policy.

## Hardening posture (what's enforced today)

| Layer | Control |
|---|---|
| **Webhook auth** | `crypto.timingSafeEqual` on `Authorization` header (accepts `Bearer <secret>` or raw); body capped at 256KB before `JSON.parse`; replay dedupe via `UNIQUE(signature)` |
| **Dashboard auth** | `x-sentinel-token` constant-time check on all `/api/escalations` POSTs; explicit dev opt-out via `SENTINEL_ALLOW_UNAUTH_DASHBOARD=1` (never silent) |
| **Owner key** | Phantom wallet adapter passes through to Ledger when present; demo-mode keypair displays a `[DEMO MODE]` banner in `wallet-controls.tsx` |
| **Approve-and-update** | Agent pubkey is locked to the escalation row; new policy YAML goes through `/api/policy` server validation; canonical sha256 root rendered before signing (eliminates confused-deputy) |
| **TOCTOU** | `sentinel-signer.ts` re-reads policy YAML on each `signTransaction` if `mtimeMs` changed |
| **YAML parser** | `{ maxAliasCount: 100 }` + 64KB file size cap (defends against alias-bomb / billion-laughs) |
| **On-chain root** | Subscribed via `onAccountChange` (unforgeable signal); WS-fail forces `cacheTtlMs=0`; `record.agent` cross-checked before trusting root; `POLICY_MISMATCH` does not echo on-chain hex |
| **tx-parser** | Versioned (v0) txs rejected; Token-2022 explicitly rejected (`TOKEN_2022_NOT_SUPPORTED`); unknown programs deny-by-default unless in `policy.programs.allow` |
| **Rate-limiter** | Per-agent prune (no cross-tenant wipe); atomic `signAllTransactions` (no mid-batch partial spend records on later denial) |
| **Input validation** | `parseRequirements` rejects empty/non-JSON/negative/non-finite/oversized headers; `escalations.requirements` capped at 4KB and schema-validated |
| **Anchor program** | `has_one = owner` on update + revoke; `revoke_policy` constraint `!policy.revoked` (re-revoke errors); checked-add on version |

## Residual CVEs (transitive — not in our hot path)

`pnpm audit` reports 27 advisories at the time of writing. Each was
triaged. Categories:

### Test toolchain only (not shipped to production)
- `mocha → serialize-javascript` (high RCE) — used by `anchor test`. Not in the deployed dashboard or the signer-shim runtime.
- `vitest → vite → esbuild` (moderate dev-server SSRF) — only on `vitest run`. CI-only.

### Wallet adapters we do NOT use as primary path
- `@solana/wallet-adapter-walletconnect → … → lodash` (high prototype pollution, code injection) — Sentinel's UI mounts only Phantom + Solflare. WalletConnect is bundled by `@solana/wallet-adapter-wallets` but never selected. **Mitigation:** future cleanup is to import individual adapters instead of the meta-package.
- `@solana/wallet-adapter-trezor → … → protobufjs` (critical RCE) — same: Trezor adapter not selected.
- `@solana/wallet-adapter-torus → … → elliptic` (low) — same.
- `@solana/wallet-adapter-solflare → … → uuid` (moderate buffer-bounds) — Solflare is enabled. The `uuid` overflow requires caller-supplied buffer; we don't pass one. **Action:** verified by tracing `node_modules/@solflare-wallet/sdk` usage; confirmed no `uuid(..., buf)` callers.

### Solana toolchain transitive
- `@solana/spl-token → @solana/buffer-layout-utils → bigint-buffer` (high overflow in `toBigIntLE`) — **upstream issue**. The vulnerable function is invoked when decoding token instructions. We do invoke `decodeTransferCheckedInstruction` and `decodeTransferInstruction`. **Mitigation:** the input bytes come from a `Transaction` already constructed by the signer or x402 builder — not directly attacker-controlled. Even so, an adversary who can craft an instruction with a malformed amount field could trigger this. We do additional zod size checks at the policy level. **Action:** track upstream patch in `bigint-buffer`; pin via overrides if it becomes critical.

### Dashboard-only, behind operator auth
- `@monaco-editor/react → monaco-editor → dompurify` (8 moderate XSS / prototype pollution) — Monaco is loaded only on the Policy Editor panel of the dashboard, which sits behind `SENTINEL_DASHBOARD_TOKEN`. We do not pass user-supplied HTML to dompurify. **Action:** if a hostile operator wallet is in scope (it isn't, per trust model), this would matter; for now, low risk.
- `next` (high DoS, moderate cache) — bumped to `^14.2.35` (latest 14.x, all currently published advisories patched). Migration to Next 15 is post-MVP.

### Build-only
- `next > postcss` (moderate stringify XSS) — only if untrusted CSS flows through PostCSS. Sentinel's CSS is internal; not affected.

## What we don't do (yet)

- **HMAC-of-body for webhook payloads.** Helius doesn't ship body-HMAC by default; we accept a static secret. Acceptable for the closed agent ↔ dashboard pair the trust model assumes; not acceptable for a multi-tenant SaaS.
- **Time-locked update_policy.** A compromised owner key can update immediately. Documented as a future improvement in `docs/TRUST_MODEL.md`.
- **CI-on-every-PR `pnpm audit --audit-level high`.** Recommended for downstream forks.

## Verification commands

```bash
# Run the full hardened test suite
pnpm -r test

# Workspace typecheck
pnpm -r typecheck

# Dependency audit
pnpm audit --audit-level high

# Production build (also flushes type-collection issues)
pnpm -F @sentinel/app exec next build
```

All four are green at the time of the latest hardening pass (95 tests across vitest + anchor mocha; see `CHANGELOG.md` for the full diff).
