# Sentinel — Implementation Plan **v3** (bombarded with context)

> Reads as the executor's bible. Every phase has per-file specs, exports, invariants, common pitfalls, and links to the *one* source you check when stuck. If a fact is not in this doc or the linked source, treat it as unverified and probe before coding.

---

## 0. How to use this document

1. **Top-down once.** Read sections 1–3 cover-to-cover before writing any code. They define the contract every later phase honors.
2. **Top-down per phase.** When you start a phase, read its whole section before any task.
3. **Per-file spec is the source of truth.** Don't deviate without writing the deviation into `CHANGELOG.md` *first*.
4. **Build → Verify → Commit.** No phase advances until its `Definition of Done` is binary-true. No commit goes in without a `pnpm test` (or `anchor test`) green run.
5. **Probe before integrating.** Any time we touch an external surface (Zerion `ctx`, Helius webhook payload, Pyth Hermes response shape, Dune SIM JSON), the *first task* is a probe that dumps the live shape into `RESOURCES.md`. We never code against an assumed shape.

---

## 1. Carry-over from v2 (frozen decisions — do not relitigate)

| Decision | Value | Why |
|---|---|---|
| Tracks targeted | Zerion #1, Zerion #2, Dune SIM, RPC Fast/Helius, 100xDevs, Adevar/Eitherway, Superteam India | Maximize side-track coverage while staying solo-shippable |
| Approval queue store | SQLite via `better-sqlite3` | Zero infra, sync API, file-based — perfect for a 17-day MVP |
| USD oracle | Pyth Hermes (off-chain pull) via `@pythnetwork/hermes-client` | No on-chain price needed; fast and free |
| Zerion integration | ESM policy file dropped into Zerion's policy directory | Verified extension point; no fork needed |
| x402 SDK | `@quicknode/x402-solana` (primary) or `@faremeter/payment-solana` (fallback) | Both verified to work on devnet today |
| Event ingestion | Helius webhooks (primary) or `connection.onLogs` (fallback) | Dune SIM cannot index custom Anchor program events |
| Dune SIM usage | Wallet-balance widget only (track qualification, not core data path) | SIM has only `/svm/balances` and `/svm/transactions` |
| Rust target | 1.93.0 | Already installed |
| Anchor | 0.32.1 | Already installed (use `#[derive(InitSpace)]`, declarative IDL) |
| Solana CLI | Agave 3.0.13 | Already installed |
| `@solana/web3.js` | `^1.95` (NOT v2 / `@solana/kit`) | Anchor 0.32 TS client expects v1 |
| Node | 24.11 | Compatible with `better-sqlite3` once native rebuild succeeds |
| pnpm | 10.20 | Workspace manager |

---

## 2. Cross-cutting standards (apply to every package)

### 2.1 Repo layout (final)

```
sentinel/
├── pnpm-workspace.yaml
├── package.json                  # root: scripts only, "private": true
├── tsconfig.base.json
├── .editorconfig
├── .gitignore
├── .env.example                  # commit; .env is git-ignored
├── README.md
├── CHANGELOG.md                  # Keep a Changelog format
├── RESOURCES.md                  # verified package versions, sponsor URLs, probed schemas
├── docs/
│   ├── threat-model.md
│   ├── policy-context-shape.md   # the actual ctx schema we observed from Zerion
│   ├── helius-payload.md         # the actual webhook payload we observed
│   └── pyth-response.md          # the actual Hermes response shape we observed
├── examples/
│   └── policies/
│       ├── small.yml
│       ├── medium.yml
│       └── strict.yml
├── packages/
│   ├── policy-dsl/
│   ├── signer-shim/
│   ├── x402-interceptor/
│   └── zerion-bridge/
├── programs/
│   └── sentinel-registry/
├── tests/                        # Anchor cross-program integration tests
├── app/                          # Next.js 14 dashboard
├── Anchor.toml
└── Cargo.toml                    # Rust workspace root
```

### 2.2 Top-level config files (exact contents)

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "packages/*"
  - "app"
```

**`tsconfig.base.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

**`.gitignore` (minimum entries)**
```
node_modules/
.pnpm-store/
.DS_Store
.env
.env.local
*.tsbuildinfo
dist/
.next/
out/
target/
.anchor/
test-ledger/
*.log
.idea/
.vscode/
```

**`.env.example`** (this file is committed; `.env` is not)
```
# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_KEYPAIR_PATH=/Users/you/.config/solana/sentinel-dev.json
SENTINEL_REGISTRY_PROGRAM_ID=

# Helius
HELIUS_API_KEY=
HELIUS_WEBHOOK_SECRET=             # arbitrary string we set; Helius echoes it as Authorization

# Dune SIM
SIM_API_KEY=

# Pyth (no key needed for Hermes REST)
PYTH_HERMES_URL=https://hermes.pyth.network

# x402
X402_FACILITATOR_URL=
X402_RECEIVING_ADDRESS=

# App
DATABASE_PATH=./.data/sentinel.db
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**`Anchor.toml`** (after Phase 0)
```toml
[toolchain]
anchor_version = "0.32.1"

[features]
seeds = false
skip-lint = false

[programs.devnet]
sentinel_registry = "<filled-after-first-deploy>"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/sentinel-dev.json"

[scripts]
test = "pnpm vitest run --dir tests"
```

**`Cargo.toml`** (workspace root)
```toml
[workspace]
members = ["programs/*"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
```

**Root `package.json`**
```json
{
  "private": true,
  "name": "sentinel",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "clean": "pnpm -r clean && rm -rf target .anchor"
  },
  "packageManager": "pnpm@10.20.0",
  "engines": { "node": ">=20" }
}
```

### 2.3 Logging convention

- One library: `pino` (`pnpm add -F <pkg> pino`).
- One log emitter per package, set `name: '@sentinel/<pkg-name>'`.
- Levels: `trace | debug | info | warn | error | fatal`.
- **Redact** these keys at the logger level: `keypair, secretKey, privateKey, ZERION_API_KEY, HELIUS_API_KEY, SIM_API_KEY, authorization`.
- Every policy verdict emits exactly one log line with: `{ verdict, reason, txSig?, agent, durationMs }`.

### 2.4 Error envelope (uniform across packages)

```ts
export interface SentinelError {
  code: string;        // SCREAMING_SNAKE_CASE, stable
  message: string;     // human-readable, English
  details?: Record<string, unknown>;
  cause?: unknown;
}
```

Codes used (any new code must be added to `RESOURCES.md`):
- `POLICY_MISMATCH` — local policy hash != on-chain root.
- `POLICY_VIOLATION` — rule engine returned `Deny`.
- `POLICY_REVOKED` — on-chain `revoked = true`.
- `RATE_LIMITED` — sliding window exceeded.
- `UNSUPPORTED_TX` — versioned transaction or unknown program.
- `ORACLE_UNAVAILABLE` — Hermes returned non-200 or stale price.
- `REGISTRY_FETCH_FAILED` — RPC error reading PDA.
- `WEBHOOK_AUTH_FAILED` — Helius callback missing/wrong `Authorization`.
- `INVALID_POLICY` — YAML or zod parse fail.

### 2.5 Versioning + CHANGELOG

- `CHANGELOG.md` follows Keep a Changelog (https://keepachangelog.com/).
- Single section `[Unreleased]` until submission; on submit day, tag `v0.1.0`.
- Each new code path gets one bullet under `### Added` / `### Changed` / `### Fixed`.

### 2.6 Test convention

- TS packages: **Vitest** (`pnpm vitest run`). Coverage target: 80% on `policy-dsl/src/engine.ts`, 60% on everything else.
- Anchor program: `anchor test` (uses Mocha by default — fine).
- Every test file ends with `.test.ts` and lives next to the source it tests, not in a separate `__tests__/` dir.

### 2.7 Lint + format

- `eslint` flat config, `@typescript-eslint`, `eslint-config-prettier`.
- `prettier` defaults; `printWidth: 100`.
- `lint-staged` + `husky` *only if* setup takes <15 minutes — otherwise skip and rely on CI.

### 2.8 CI minimum (GitHub Actions)

Single workflow `ci.yml`:
1. Set up Node 24, pnpm, Rust 1.93, Anchor 0.32.
2. `pnpm install --frozen-lockfile`
3. `pnpm typecheck`
4. `pnpm test`
5. `anchor build` (do not deploy in CI; just compile)

If CI takes more than 30 minutes to wire up, **skip CI and rely on a `pnpm verify` script run locally before each push.**

---

## 3. Threat model + invariants

### 3.1 What Sentinel protects

| Asset | Threat | Mitigation |
|---|---|---|
| Agent's signing key | Compromised agent process signs unauthorized tx | Local rule check before signing; on-chain root mismatch refuses to sign |
| Policy contents | Attacker swaps local YAML | On-chain root comparison; any drift → `POLICY_MISMATCH` error |
| On-chain policy | Attacker hijacks `update_policy` | `has_one = owner` constraint; `owner` should be a hardware wallet on a separate machine |
| Approval queue | Attacker injects fake approvals | SSE channel authenticated via short-lived bearer token; CSRF on approval form |

### 3.2 What Sentinel does NOT protect

- Logic bugs *inside* the agent that produce in-policy but unwanted txs.
- Network-level attacks (RPC MITM) — assume `https` and don't verify chain state via custom proxies.
- Social engineering of the operator.

### 3.3 System invariants (every phase upholds these)

1. **No tx is signed without a fresh policy fetch** (subject to 30s cache TTL with WS invalidation).
2. **`PolicyRecord.revoked == true` ⇒ no signature ever.** The shim refuses regardless of local YAML.
3. **Rate-limit storage is monotonic.** We never decrement counters; we only add and prune by time.
4. **Pyth prices older than 60 seconds are never trusted.** Stale price ⇒ treat tx as escalate (not allow).
5. **Versioned (v0) transactions are rejected** in MVP. Documented limitation.
6. **Every state change on-chain emits an event.** No silent mutations.
7. **The policy root is the *only* identity bind between local YAML and on-chain state.** Don't add side channels.

---

## 4. Phase 0 — Foundations (Day 1)

### 4.1 Definition of Done
- Devnet wallet funded ≥ 1 SOL.
- `pnpm install` succeeds top-to-bottom on a fresh clone.
- `anchor build` produces a `.so` for an empty program.
- A no-op Zerion policy file logs `ctx` and we have its shape captured in `docs/policy-context-shape.md`.
- All env vars in `.env.example` either filled or stubbed in `.env`.

### 4.2 Tasks

#### P0.T1 — Tooling sanity check
- `solana --version` ≥ Agave 3.0.13.
- `anchor --version` ≥ 0.32.1.
- `node -v` ≥ 24.11.0.
- `rustc --version` ≥ 1.93.
- `pnpm -v` ≥ 10.20.0.

If `anchor --version` reports anything 0.30.x but the binary is 0.32, you've shadowed `avm`. Run `which anchor` and resolve.

#### P0.T2 — Create devnet keypair + fund
```bash
solana-keygen new --outfile ~/.config/solana/sentinel-dev.json --no-bip39-passphrase
solana config set --url devnet --keypair ~/.config/solana/sentinel-dev.json
solana airdrop 2
```

If airdrop is rate-limited, use https://faucet.solana.com (web). Do NOT switch IP — sponsors look at the address history.

#### P0.T3 — Repo scaffold
- `mkdir sentinel && cd sentinel && git init && pnpm init`
- Create every file in section 2.2 verbatim.
- `pnpm add -Dw typescript vitest @types/node tsx pino`
- `pnpm add -Dw -F packages/* @sentinel/* via workspace` (later, when packages exist)
- First commit: `chore: scaffold workspace`.

#### P0.T4 — **Probe Zerion `PolicyContext` shape** (CRITICAL — do not skip)
- `npm install -g zerion-cli@latest`
- `export ZERION_API_KEY=zk_dev_...` (free key from https://dashboard.zerion.io)
- Write `~/.config/zerion/policies/sentinel-probe.mjs`:
  ```js
  import { writeFileSync, mkdirSync } from "node:fs";
  import { homedir } from "node:os";
  import { join } from "node:path";

  export function check(ctx) {
    mkdirSync(join(homedir(), ".sentinel-probe"), { recursive: true });
    writeFileSync(
      join(homedir(), ".sentinel-probe", `ctx-${Date.now()}.json`),
      JSON.stringify(ctx, null, 2),
    );
    return { allow: false, reason: "Sentinel probe — denied by design." };
  }
  ```
- Register with Zerion CLI (commands TBD via `zerion-cli agent create-policy --help`).
- Run one `zerion-cli wallet swap …` (or any agent-token tx) on devnet.
- Inspect `~/.sentinel-probe/ctx-*.json` and copy the shape into `docs/policy-context-shape.md`.

**This file is the source of truth for what the rule engine adapter consumes.** Without it, the bridge is dead reckoning.

#### P0.T5 — Anchor scaffold + first deploy
```bash
anchor init programs-temp --no-git --javascript=false
mv programs-temp/programs/programs-temp programs/sentinel-registry
# clean up the rest of programs-temp
anchor build
anchor deploy
solana program show <programId>
```
Capture the program ID into `Anchor.toml` and `programs/sentinel-registry/src/lib.rs` (`declare_id!`). Rebuild + redeploy once.

#### P0.T6 — Helius + Dune SIM keys
- Sign up: https://dev.helius.xyz, https://sim.dune.com.
- Drop keys into `.env`, leave placeholders in `.env.example`.

#### P0.T7 — Commit + push
- Branch: `main` only for MVP. No PR ceremony.
- Tag this commit `phase-0-done`.

---

## 5. Phase 1 — `packages/policy-dsl/` (Days 2–3)

### 5.1 Package metadata

**`packages/policy-dsl/package.json`**
```json
{
  "name": "@sentinel/policy-dsl",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./schema": "./dist/schema.js",
    "./engine": "./dist/engine.js",
    "./canonicalize": "./dist/canonicalize.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "yaml": "^2.5.0",
    "zod": "^3.23.0",
    "json-stable-stringify": "^1.1.1"
  },
  "devDependencies": {
    "@types/json-stable-stringify": "^1.0.36",
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
```

### 5.2 Per-file specs

#### `src/types.ts`
**Purpose:** all shared types. No runtime code.
**Exports:**
```ts
export type Token = "SOL" | "USDC" | { mint: string };

export interface TxSummary {
  agent: string;          // base58 pubkey
  token: Token;
  amount: number;         // human units (NOT lamports/decimals)
  destination: string;    // base58 pubkey
  programId: string;      // base58 pubkey
  usdValue: number;       // ≥ 0; if oracle stale, set to Number.POSITIVE_INFINITY
  timestamp: number;      // unix ms, UTC
}

export type Verdict =
  | { type: "allow" }
  | { type: "escalate"; reason: string }
  | { type: "deny"; reason: string };
```

**Invariants:**
- `amount` is in *human* units (1 USDC = 1.0, NOT 1_000_000). Decimal handling lives in `signer-shim`.
- `usdValue` is informational; rules that use USD must explicitly check it and have a fallback for `Infinity`.

#### `src/schema.ts`
**Purpose:** the single zod schema for policy v1.
**Exports:**
```ts
export const TokenSchema = z.union([
  z.literal("SOL"),
  z.literal("USDC"),
  z.object({ mint: z.string().min(32).max(44) }),
]);

export const CapSchema = z.object({
  token: TokenSchema,
  max_per_tx: z.number().positive().optional(),
  max_per_day: z.number().positive().optional(),
  max_per_hour: z.number().positive().optional(),
}).strict();

export const PolicyV1 = z.object({
  version: z.literal(1),
  agent: z.string().min(32).max(44),     // base58 pubkey, 32-44 chars
  caps: z.array(CapSchema).default([]),
  allowlist: z.object({
    destinations: z.array(z.string()).default([]),
  }).optional(),
  denylist: z.object({
    destinations: z.array(z.string()).default([]),
  }).optional(),
  programs: z.object({
    allow: z.array(z.string()).optional(),
  }).optional(),
  escalate_above: z.object({
    usd_value: z.number().positive().optional(),
  }).optional(),
  rate_limit: z.object({
    max_tx_per_minute: z.number().int().positive().optional(),
  }).optional(),
}).strict();

export type Policy = z.infer<typeof PolicyV1>;
```

**Behavior:**
- `.strict()` everywhere — unknown keys fail fast with `INVALID_POLICY`.
- Pubkey strings: 32–44 chars (base58 of 32 bytes ranges from 32 to 44 in length). Don't enforce regex more tightly; we'll do the actual base58 check at signer time.

**Common pitfalls:**
- YAML `1` parses as number, but `version: 1` is what we want. Don't make `version` a string.
- `1_000_000` (numeric separators) is JS-only — YAML parses it as the literal string. Use `1000000` in policies.

#### `src/canonicalize.ts`
**Purpose:** deterministic JSON + 32-byte SHA-256 root.
**Exports:**
```ts
export function canonicalJson(policy: Policy): string;
export function policyRoot(policy: Policy): Uint8Array;  // 32 bytes
export function policyRootHex(policy: Policy): string;   // 64-char lowercase hex
```

**Algorithm:**
1. Validate via `PolicyV1.parse`.
2. Run `json-stable-stringify` with `{ space: 0 }`.
3. UTF-8 encode.
4. `crypto.createHash("sha256").update(buf).digest()`.

**Test fixtures (mandatory):**
- `differentKeyOrder.test.ts` — same policy with `caps` before vs after `allowlist` ⇒ identical root.
- `whitespace.test.ts` — same policy serialized with various YAML whitespace ⇒ identical root.
- `arrayOrder.test.ts` — `caps: [a, b]` vs `caps: [b, a]` ⇒ DIFFERENT roots (this is intentional — order is semantic for caps).

**Doc:** RFC 8785 (https://datatracker.ietf.org/doc/html/rfc8785) — read once, stop worrying.

#### `src/engine.ts`
**Purpose:** pure function `(policy, txSummary, history) → Verdict`.
**Exports:**
```ts
export interface EvalContext {
  policy: Policy;
  tx: TxSummary;
  history: SpendHistory;   // injected by signer-shim's rate-limiter
  now: number;             // unix ms — explicit for testability
}

export interface SpendHistory {
  spentInWindow(token: Token, windowMs: number, nowMs: number): number;
  txCountInWindow(windowMs: number, nowMs: number): number;
}

export function evaluate(ctx: EvalContext): Verdict;
```

**Precedence (compose verdicts top-down):**
1. **Denylist** matches → `deny`.
2. **Programs allow-set** misses → `deny`.
3. **Allowlist** misses → `deny`.
4. **Caps** exceeded → `deny`.
5. **Rate limit** exceeded → `deny`.
6. **Escalate threshold** exceeded → `escalate`.
7. Otherwise → `allow`.

**Verdict reason format:** human-readable, ends without period, references the failing rule key. Example: `"caps[0].max_per_day exceeded: 51 USDC > 50 USDC"`.

**Tests (mandatory — 15 fixtures):**
| # | Scenario | Expected |
|---|---|---|
| 1 | Empty policy, simple SOL transfer | allow |
| 2 | USDC transfer, USDC cap not hit | allow |
| 3 | Destination on denylist | deny |
| 4 | Destination not on allowlist | deny |
| 5 | Program not on allow list | deny |
| 6 | `max_per_tx` exceeded | deny |
| 7 | `max_per_day` exceeded by 0.01 | deny |
| 8 | `max_per_hour` exceeded by 0.01 | deny |
| 9 | `max_tx_per_minute` exceeded | deny |
| 10 | Stale oracle (`usdValue = Infinity`) and escalate threshold set | escalate |
| 11 | `escalate_above.usd_value` exceeded by $1 | escalate |
| 12 | All rules pass, no escalate threshold | allow |
| 13 | Allowlist + denylist conflict (denylist wins) | deny |
| 14 | Caps unset, allowlist passes | allow |
| 15 | Rate-limit window crosses minute boundary | allow when window slides |

**Common pitfalls:**
- Time windows in *local* timezone. Always UTC. Always compare `nowMs - windowMs`.
- Floating-point cap comparisons. Round to 9 decimal places before comparing (Solana's max precision).
- Treating an undefined cap as 0. Undefined cap means "no cap" — short-circuit before comparing.

#### `src/index.ts`
Re-exports types, schema, engine, canonicalize.

#### `examples/policies/small.yml`
```yaml
version: 1
agent: <DEVNET_AGENT_PUBKEY>
caps:
  - token: SOL
    max_per_day: 0.5
```

#### `examples/policies/medium.yml`
```yaml
version: 1
agent: <DEVNET_AGENT_PUBKEY>
caps:
  - token: USDC
    max_per_tx: 10
    max_per_day: 50
allowlist:
  destinations:
    - <DEX_ROUTER_1>
    - <DEX_ROUTER_2>
rate_limit:
  max_tx_per_minute: 6
```

#### `examples/policies/strict.yml`
```yaml
version: 1
agent: <DEVNET_AGENT_PUBKEY>
caps:
  - token: SOL
    max_per_day: 0
  - token: USDC
    max_per_day: 5
allowlist:
  destinations: [<TREASURY_PUBKEY>]
programs:
  allow: [<TOKEN_PROGRAM_ID>, <SYSTEM_PROGRAM_ID>]
escalate_above:
  usd_value: 1
rate_limit:
  max_tx_per_minute: 2
```

---

## 6. Phase 2 — `programs/sentinel-registry/` (Days 4–6)

### 6.1 Definition of Done
- Program deployed to devnet.
- Anchor TS test runs full lifecycle green.
- IDL committed to `programs/sentinel-registry/target/idl/sentinel_registry.json`.
- Helius webhook (P5) decodes our events from logs without a custom IDL upload (Helius reads on-chain IDL).

### 6.2 Per-file specs

#### `Cargo.toml`
```toml
[package]
name = "sentinel-registry"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "sentinel_registry"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
idl-build = ["anchor-lang/idl-build"]

[dependencies]
anchor-lang = "0.32.1"
```

> **Verify on first build:** Anchor 0.32 may have moved IDL types into a separate crate (`anchor-lang-idl`). If `anchor build` complains about `idl-build` feature, run `anchor --version` to confirm 0.32.1 and consult https://www.anchor-lang.com/release-notes for the 0.32 migration notes.

#### `src/lib.rs`
**Account:**
```rust
use anchor_lang::prelude::*;

declare_id!("<filled-after-first-deploy>");

#[program]
pub mod sentinel_registry {
    use super::*;

    pub fn register_policy(
        ctx: Context<RegisterPolicy>,
        agent: Pubkey,
        root: [u8; 32],
    ) -> Result<()> { /* ... */ }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        new_root: [u8; 32],
    ) -> Result<()> { /* ... */ }

    pub fn revoke_policy(
        ctx: Context<RevokePolicy>,
    ) -> Result<()> { /* ... */ }
}

#[account]
#[derive(InitSpace)]
pub struct PolicyRecord {
    pub owner: Pubkey,        // 32
    pub agent: Pubkey,        // 32
    pub root: [u8; 32],       // 32
    pub version: u32,         // 4
    pub revoked: bool,        // 1
    pub created_at: i64,      // 8
    pub updated_at: i64,      // 8
    pub bump: u8,             // 1
    pub _reserved: [u8; 100], // future-proof buffer
}
```

> **Note on `#[derive(InitSpace)]`:** Anchor 0.30+ computes `INIT_SPACE` automatically (excluding the 8-byte discriminator). Use `space = 8 + PolicyRecord::INIT_SPACE` in the `init` constraint.

**Account contexts:**
```rust
#[derive(Accounts)]
#[instruction(agent: Pubkey)]
pub struct RegisterPolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + PolicyRecord::INIT_SPACE,
        seeds = [b"policy", agent.as_ref()],
        bump
    )]
    pub policy: Account<'info, PolicyRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"policy", policy.agent.as_ref()],
        bump = policy.bump,
        has_one = owner @ SentinelError::Unauthorized,
        constraint = !policy.revoked @ SentinelError::PolicyRevoked,
    )]
    pub policy: Account<'info, PolicyRecord>,
}

#[derive(Accounts)]
pub struct RevokePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"policy", policy.agent.as_ref()],
        bump = policy.bump,
        has_one = owner @ SentinelError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyRecord>,
}
```

**Events:**
```rust
#[event]
pub struct PolicyRegistered {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub root: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct PolicyUpdated {
    pub agent: Pubkey,
    pub previous_root: [u8; 32],
    pub new_root: [u8; 32],
    pub version: u32,
    pub timestamp: i64,
}

#[event]
pub struct PolicyRevoked {
    pub agent: Pubkey,
    pub timestamp: i64,
}
```

**Errors:**
```rust
#[error_code]
pub enum SentinelError {
    #[msg("Caller is not the policy owner")]
    Unauthorized,
    #[msg("Policy is revoked and cannot be modified")]
    PolicyRevoked,
}
```

**Behavior contract:**
- `register_policy(agent, root)`: PDA must not exist. Sets `owner = signer`, `created_at = updated_at = Clock::get()?.unix_timestamp`, `version = 1`, `revoked = false`. Emits `PolicyRegistered`.
- `update_policy(new_root)`: caller must be `policy.owner`. `revoked` must be false. Bumps `version`, sets `updated_at`. Emits `PolicyUpdated` with `previous_root` and `new_root`.
- `revoke_policy()`: caller must be `policy.owner`. Sets `revoked = true`, updates `updated_at`. Account stays open. Emits `PolicyRevoked`.

**Why we don't `close = receiver` on revoke:** we want the on-chain record of the revocation to persist for audit. Cost is ~0.002 SOL/year of rent — accept it.

#### `tests/sentinel-registry.ts`
**Purpose:** end-to-end lifecycle as Anchor TS test.

```ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SentinelRegistry } from "../target/types/sentinel_registry";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("sentinel-registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SentinelRegistry as Program<SentinelRegistry>;
  const owner = (provider.wallet as anchor.Wallet).payer;
  const agent = Keypair.generate();
  const root1 = new Uint8Array(32).fill(0xaa);
  const root2 = new Uint8Array(32).fill(0xbb);

  let pda: PublicKey, bump: number;

  before(() => {
    [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), agent.publicKey.toBuffer()],
      program.programId,
    );
  });

  it("registers a policy", async () => {
    await program.methods
      .registerPolicy(agent.publicKey, [...root1])
      .accounts({ owner: owner.publicKey, policy: pda, systemProgram: SystemProgram.programId })
      .rpc();
    const rec = await program.account.policyRecord.fetch(pda);
    expect(rec.version).to.equal(1);
    expect(rec.revoked).to.be.false;
  });

  it("updates the policy and bumps version", async () => { /* ... */ });
  it("rejects update from a non-owner signer", async () => { /* expect throws Unauthorized */ });
  it("revokes the policy", async () => { /* ... */ });
  it("rejects update after revoke", async () => { /* expect throws PolicyRevoked */ });
  it("emits the right events on each instruction", async () => {
    // Use connection.onLogs to subscribe and assert event names appear.
  });
});
```

**Common pitfalls:**
- Anchor 0.30+ `Program` constructor reads program ID from IDL. Don't pass it as a separate arg.
- `findProgramAddressSync` (web3.js v1) is sync — use it. The async variant `findProgramAddress` was deprecated.
- IDL JSON moves between versions. After `anchor build`, the IDL is at `target/idl/sentinel_registry.json`. The TS types are at `target/types/sentinel_registry.ts` — *that* path is what the test imports.

**Docs to keep open:**
- Anchor accounts: https://www.anchor-lang.com/docs/account-types
- PDAs: https://solana.com/docs/core/pda
- Anchor TS client: https://www.anchor-lang.com/docs/clients/typescript
- Anchor 0.30 migration: https://www.anchor-lang.com/release-notes

---

## 7. Phase 3 — `packages/signer-shim/` (Days 7–9)

### 7.1 Definition of Done
- A test agent can construct `new SentinelSigner({ ... })` and pass it as `Signer` to a real Solana tx on devnet.
- A live policy mismatch triggers `POLICY_MISMATCH`.
- Three policies (small, medium, strict) yield correct verdicts on 6 fixture txs each.
- Pyth oracle returns a USD value within 60 seconds of fetch.

### 7.2 Per-file specs

#### `package.json` dependencies
```
@solana/web3.js@^1.95
@coral-xyz/anchor@^0.32
@solana/spl-token@^0.4
@pythnetwork/hermes-client@^1
better-sqlite3@^11
yaml@^2.5
@sentinel/policy-dsl@workspace:*
pino@^9
```

> **better-sqlite3 + Node 24 caveat:** if `pnpm install` errors with `node-gyp` on macOS/Linux, run `xcode-select --install` (mac) or `apt-get install build-essential python3` (Linux). The package builds a native module against Node's headers. Pin a specific version (`11.5.0` is known good on Node 24) if the latest fails.

#### `src/sentinel-signer.ts`
**Purpose:** drop-in replacement for `web3.js` `Signer`.
**Exports:**
```ts
export interface SentinelSignerConfig {
  policyPath: string;          // local YAML
  agentKeypair: Keypair;       // ed25519
  ownerPubkey: PublicKey;      // for PolicyRecord lookup
  registryProgramId: PublicKey;
  rpcUrl: string;
  hermesUrl?: string;          // default: https://hermes.pyth.network
  rateLimitDb?: string;        // default: ./.data/sentinel.db
  cacheTtlMs?: number;         // default: 30000
  log?: Logger;
}

export class SentinelSigner implements Signer {
  readonly publicKey: PublicKey;
  constructor(cfg: SentinelSignerConfig);
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
}
```

**Behavior contract:**
1. Reject any `VersionedTransaction` (use `instanceof`).
2. Parse tx → `TxSummary[]` (one per instruction).
3. Fetch on-chain root (cached) + compare to local YAML root → `POLICY_MISMATCH` if mismatch.
4. For each `TxSummary`, evaluate via rule engine.
5. If any verdict is `deny` → throw `SentinelError(POLICY_VIOLATION)`.
6. If any verdict is `escalate` → enqueue and throw `SentinelError(ESCALATION_REQUIRED)` with a queue ID; the caller (x402 interceptor or Zerion bridge) decides what to do.
7. Otherwise sign with `agentKeypair`.

**Invariants:**
- Throws are the only error path. Never returns an unsigned tx silently.
- A single tx with 5 instructions runs the engine 5 times. Worst-case verdict wins (deny > escalate > allow).

#### `src/tx-parser.ts`
**Purpose:** `Transaction → TxSummary[]`.
**Exports:**
```ts
export interface ParseEnv {
  splDecimalsCache: Map<string, number>;   // mint -> decimals
  oracle: PriceOracle;
  rpcUrl: string;
}
export async function parseTx(tx: Transaction, env: ParseEnv): Promise<TxSummary[]>;
```

**Per-instruction logic:**
- **System Program** (`SystemProgram.programId`):
  - Discriminator: first 4 bytes of `ix.data` are little-endian u32.
  - `2` = Transfer. Parse `lamports = data.readBigUInt64LE(4)`.
  - Other variants → return `{ token: "SOL", amount: 0, ... }` with reason `"non-transfer system ix"`.
- **SPL Token Program** (`TOKEN_PROGRAM_ID` from `@solana/spl-token`):
  - Use `decodeTransferCheckedInstruction` (preferred — includes amount + decimals).
  - Fallback: `decodeTransferInstruction`. If decimals unknown, fetch mint info via RPC (`getMint`) and cache.
- **Anything else:** return `TxSummary` with `token: { mint: "<unknown>" }`, `amount: 0`, `programId: <programId>`. Rule engine will deny via `programs.allow` if configured.

**Reject hard:**
- `VersionedTransaction` instances → throw `UNSUPPORTED_TX`.
- `transaction.instructions.length === 0` → throw `UNSUPPORTED_TX`.

**Common pitfalls:**
- `decodeTransferCheckedInstruction` validates the program ID — pass `TOKEN_PROGRAM_ID` (not Token-2022's). Token-2022 support is post-MVP.
- SPL `Transfer` (legacy) doesn't include decimals; `TransferChecked` does. Prefer the checked variant in *our* tests, but the parser must handle both inbound.

#### `src/price-oracle.ts`
**Purpose:** fetch USD value for `(token, amount)` via Pyth Hermes.
**Exports:**
```ts
export interface PriceOracle {
  usd(token: Token, amount: number): Promise<number>;
}

export function createHermesOracle(opts: { hermesUrl: string; ttlMs?: number }): PriceOracle;
```

**Behavior:**
- For `SOL`: feed ID `<SOL/USD-feed-id>` (look up at https://pyth.network/developers/price-feed-ids). Hermes returns price + confidence + expo. USD = `price * 10^expo * amount`.
- For `USDC`: peg to 1.0 *only after* a sanity-check fetch on first call (assert |price - 1| < 0.05). If sanity fails, throw `ORACLE_UNAVAILABLE`.
- For `{ mint }`: not supported in MVP — throw `ORACLE_UNAVAILABLE`. Document as a v2 feature.
- Cache: `Map<feedId, { price, fetchedAt }>` with TTL = `ttlMs ?? 10_000`. Stale entries evicted on read.
- **Stale rule:** if Hermes fetch >= 60s old (regardless of TTL), treat as stale → return `Number.POSITIVE_INFINITY`. Engine escalates.

**Hermes API surface (read once, write in `docs/pyth-response.md`):**
```ts
import { HermesClient } from "@pythnetwork/hermes-client";
const hermes = new HermesClient("https://hermes.pyth.network", {});
const result = await hermes.getLatestPriceUpdates([feedId1, feedId2]);
// result.parsed[i].price.price (string of integer), .expo (negative int), .conf
```

**Doc:** https://docs.pyth.network/price-feeds/use-real-time-data/solana — same Hermes endpoint regardless of chain.

#### `src/policy-fetch.ts`
**Purpose:** fetch on-chain `PolicyRecord` and compare roots.
**Exports:**
```ts
export interface PolicyFetcher {
  ensureMatch(localPolicy: Policy): Promise<void>;   // throws POLICY_MISMATCH | POLICY_REVOKED
  invalidateCache(): void;
  close(): Promise<void>;                            // closes WS subscriptions
}
export function createPolicyFetcher(opts: {...}): Promise<PolicyFetcher>;
```

**Behavior:**
- On construct: subscribe to `connection.onLogs(programId, ...)`; on any log mentioning our agent's PDA, invalidate the cache.
- `ensureMatch`:
  1. If cache miss or expired (TTL 30s): fetch `program.account.policyRecord.fetch(pda)`. Throw `POLICY_REVOKED` if `record.revoked`.
  2. Compute `policyRoot(localPolicy)` and compare to `Buffer.from(record.root).toString("hex")`.
  3. Throw `POLICY_MISMATCH` if differ.

**Common pitfalls:**
- `connection.onLogs` keeps a WebSocket open. Always call `close()` on shutdown or you'll leak file descriptors in long-running tests.
- Fetching the PDA when it doesn't exist throws `Account does not exist`. Catch and re-throw as `POLICY_NOT_FOUND` (add this to error envelope).

#### `src/rate-limiter.ts`
**Purpose:** sliding-window counters in SQLite.
**Schema (`migrations/001-init.sql`):**
```sql
CREATE TABLE IF NOT EXISTS spend_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  token TEXT NOT NULL,           -- "SOL" | "USDC" | mint base58
  amount REAL NOT NULL,          -- human units
  timestamp INTEGER NOT NULL     -- unix ms UTC
);
CREATE INDEX IF NOT EXISTS idx_spend ON spend_log (agent, token, timestamp);
```

**Exports:**
```ts
export interface RateLimiter extends SpendHistory {
  record(tx: TxSummary): void;
  prune(olderThanMs: number): void;
}
export function createRateLimiter(dbPath: string): RateLimiter;
```

**Invariants:**
- `record()` is idempotent on `(agent, token, timestamp)` only if you pass the same triple. Otherwise duplicates are allowed (we log every signed tx).
- `prune()` runs once on startup and once per hour. Default keep window: 7 days (configurable).

**Common pitfalls:**
- `better-sqlite3` is *synchronous*. That's fine; we want it. Don't wrap it in async or you'll create races.

#### `src/index.ts`
Re-export `SentinelSigner` and only the types other packages need.

### 7.3 Tests
- `sentinel-signer.test.ts`: stub the price oracle and policy fetcher, run 6 fixture transactions through 3 fixture policies → 18 verdicts; assert each.
- `tx-parser.test.ts`: 3 fixtures (SOL transfer, USDC checked transfer, swap with multiple ixs).
- `price-oracle.test.ts`: hit Hermes once, assert SOL price within plausible range ($50–$500 — wide on purpose), assert cache hit on second call.
- `policy-fetch.test.ts`: against devnet, register policy with one root, mutate local YAML to change root, assert `POLICY_MISMATCH`.
- `rate-limiter.test.ts`: 10 inserts in 1s, query 5/min window → returns 5 (not 10).

---

## 8. Phase 3.5 — `packages/zerion-bridge/` (Day 9)

### 8.1 Definition of Done
- `sentinel.mjs` is a single ES module file Zerion can `import()`.
- 3 fixture `ctx` objects (captured in P0.T4) pass through the bridge and yield correct verdicts.
- `sentinel-cli install` copies the file into `~/.config/zerion/policies/`.

### 8.2 Per-file specs

#### `src/ctx-shape.md` (committed alongside `docs/policy-context-shape.md`)
**Purpose:** the *exact* schema we observed from Zerion. Updated by P0.T4 probe. Example structure (TBD by probe):
```ts
interface ZerionCtx {
  transaction: {
    chain: "solana" | string;          // CAIP-2 actually — confirm via probe
    from: string;
    to?: string;                        // EVM only
    data?: string;                      // hex blob
    value?: string;
    // ...
  };
  policy_config?: {
    scripts?: string[];
    [k: string]: unknown;
  };
  // ...
}
```

#### `src/sentinel.mjs`
**Purpose:** the literal file Zerion loads.
**Contract:**
```js
import { evaluate } from "@sentinel/policy-dsl/engine";
import { canonicalJson, policyRoot } from "@sentinel/policy-dsl/canonicalize";
import { adaptCtx } from "./adapter.js";

export async function check(ctx) {
  try {
    const txSummary = adaptCtx(ctx);
    if (!txSummary) return { allow: true };  // not our chain → defer
    // For Zerion path, on-chain root check is done elsewhere; trust local policy
    const verdict = evaluate({ policy: ..., tx: txSummary, history: noopHistory, now: Date.now() });
    if (verdict.type === "deny" || verdict.type === "escalate") {
      return { allow: false, reason: verdict.reason };
    }
    return { allow: true };
  } catch (err) {
    return { allow: false, reason: `Sentinel error: ${err.message}` };
  }
}
```

**Behavior:**
- If the tx's chain is not Solana, return `{ allow: true }` (we don't gate non-Solana paths in MVP — Zerion's own EVM rules cover those).
- The Zerion path can't enforce the on-chain root invariant *inside* `check(ctx)` cheaply (no PublicKey context). For the Zerion track demo, we accept this and document it: the registry is the source of truth for the *direct signing path* (signer-shim), and the Zerion bridge applies the *same rule engine* to the same YAML for parity.

#### `src/adapter.ts`
**Purpose:** transform `ZerionCtx → TxSummary | null`.
- Detect chain via `ctx.transaction.chain` (or whatever the probe shows).
- Decode Solana tx data (likely hex-encoded serialized tx) using `Transaction.from(Buffer.from(data, "hex"))`, then run the same `tx-parser`.

#### `src/install.ts`
**Purpose:** CLI helper for end users.
- `pnpm dlx @sentinel/zerion-bridge install` copies `sentinel.mjs` to `~/.config/zerion/policies/`.
- Prints the exact `zerion-cli agent create-policy --scripts ...` command to run next.

---

## 9. Phase 4 — `packages/x402-interceptor/` (Days 10–12)

### 9.1 Definition of Done
- A demo HTTP client paying our demo server completes the 402 → pay → 200 cycle on devnet for `/cheap`, escalates on `/expensive`, denies on `/blocked`.
- `solana confirm <tx>` shows the payment.
- The interceptor uses the *same* rule engine as the signer-shim (no duplicate logic).

### 9.2 Per-file specs

#### `src/interceptor.ts`
**Purpose:** a `fetch`-compatible wrapper that catches 402s and routes them through Sentinel.
**Exports:**
```ts
export function createSentinelFetch(opts: {
  signer: SentinelSigner;
  baseFetch?: typeof fetch;     // default: globalThis.fetch
  onEscalate?: (ticket: EscalationTicket) => Promise<"approve" | "reject">;
}): typeof fetch;
```

**Behavior:**
1. Pass through non-402 responses unchanged.
2. On 402: parse `X-PAYMENT-REQUIREMENTS` header (JSON) → produce `TxSummary`.
3. Call `signer.signTransaction(paymentTx)`. If `POLICY_VIOLATION`, return a 402 to the caller with reason; if `ESCALATION_REQUIRED`, await `onEscalate`; if signed, retry the request with `X-PAYMENT` header.

**x402 protocol notes:**
- Spec: https://www.x402.org/.
- Required headers: `X-PAYMENT-REQUIREMENTS` (server → client), `X-PAYMENT` (client → server).
- Facilitator: optional. If `X402_FACILITATOR_URL` is set, server delegates verification; otherwise server verifies on-chain itself.

#### `src/server-middleware.ts`
**Purpose:** Express middleware that protects routes with x402.
**Exports:**
```ts
export function x402Protect(opts: {
  receivingAddress: string;
  pricePerCall: { token: "USDC"; amount: number };
  facilitatorUrl?: string;
}): RequestHandler;
```

#### `src/demo-server.ts`
**Purpose:** runnable demo of three protected endpoints.
- `/cheap` (0.001 USDC) — auto-approved by `examples/policies/medium.yml`.
- `/expensive` (5 USDC) — escalates because medium policy caps at $1 (verify with `escalate_above`).
- `/blocked` — receiving address on the agent's denylist → denied.

#### `src/demo-client.ts`
**Purpose:** runnable demo client that hits all three.

#### `package.json` dependencies
```
express@^4
@quicknode/x402-solana@^0  (whichever version is current; pin in RESOURCES.md after probe)
@sentinel/signer-shim@workspace:*
@sentinel/policy-dsl@workspace:*
```

> **First-day spike rule:** before writing the interceptor, run *only* the chosen x402 SDK's hello-world end-to-end on devnet. Document the exact request/response in `docs/x402-payload.md`. If anything is unstable, switch to `@faremeter/payment-solana` and update RESOURCES.md.

---

## 10. Phase 5 — `app/` Next.js dashboard (Days 13–15)

### 10.1 Definition of Done
- `pnpm dev` shows three populated panels and a wallet-balance widget against devnet.
- One *expensive* x402 call from the demo client shows up as an escalation; clicking *Approve* lets it through.
- One on-chain `update_policy` shows up in *Live Activity* within 5 seconds.

### 10.2 Architecture

```
app/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # the dashboard
│   ├── api/
│   │   ├── webhook/route.ts     # Helius receiver
│   │   ├── escalations/route.ts # GET pending, POST resolve
│   │   ├── balance/route.ts     # proxies Dune SIM
│   │   └── stream/route.ts      # SSE for the agent
│   ├── components/
│   │   ├── live-activity.tsx
│   │   ├── policy-editor.tsx    # Monaco
│   │   ├── escalation-queue.tsx
│   │   ├── balance-widget.tsx
│   │   └── approval-modal.tsx
│   └── lib/
│       ├── db.ts                # SQLite handle
│       ├── helius.ts            # webhook helpers
│       ├── sim.ts               # Dune SIM client
│       └── policy.ts            # zod parse + canonicalize re-export
└── public/
```

### 10.3 Per-file specs

#### `app/api/webhook/route.ts`
**Purpose:** receive Helius webhook payloads, validate auth, persist to SQLite.
**Behavior:**
- Read `Authorization` header; reject if it doesn't equal `process.env.HELIUS_WEBHOOK_SECRET` → 401.
- Parse body → for each `nativeTransfers`, `tokenTransfers`, `events.compressed`, etc., persist rows in `policy_events`.
- Return 200 quickly (Helius retries on 5xx; aim for < 1s).

**Helius payload shape:** capture in `docs/helius-payload.md` from the first live POST. Don't invent it.

#### `app/api/balance/route.ts`
**Purpose:** proxy Dune SIM `/beta/svm/balances/{address}` so the API key stays server-side.
**Behavior:**
```ts
const r = await fetch(
  `https://api.sim.dune.com/beta/svm/balances/${address}`,
  { headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY! } }
);
```
- Cache responses for 30s (per address) in memory (Map).

#### `app/api/escalations/route.ts`
- `GET`: list pending escalations from SQLite.
- `POST { id, action: "approve" | "reject" | "approve_and_update" }`: update the row; if `approve_and_update`, build and submit `update_policy` tx using the connected wallet.

#### `app/api/stream/route.ts`
**Purpose:** SSE channel from server to dashboard.
**Behavior:** every 1s, push the latest 5 `policy_events` rows + pending escalation count.

#### `app/components/policy-editor.tsx`
- Monaco YAML editor with live zod validation (red squiggles on parse fail).
- Save button: posts to `/api/policy` which calls `update_policy` on-chain.

#### `app/components/balance-widget.tsx`
- Polls `/api/balance/<agentPubkey>` every 30s.
- Renders top 5 holdings + USD total. This is our Dune SIM track surface.

### 10.4 Dependencies
```
next@14
react@18
@monaco-editor/react@^4
better-sqlite3@^11
@sentinel/policy-dsl@workspace:*
zod@^3
```

---

## 11. Phase 6 — Demo, docs, submission (Days 15–17)

### 11.1 Demo video script (3 min, frame-by-frame)
| Time | Beat | What's on screen |
|---|---|---|
| 0:00–0:20 | Hook | terminal — agent runs amok, drains wallet |
| 0:20–0:50 | Setup Sentinel | `cat sentinel.yml` + `sentinel deploy` (one command) |
| 0:50–1:10 | Wrap signer | one-line code change |
| 1:10–1:40 | Live demo: cheap x402 call | green log line, dashboard updates |
| 1:40–2:10 | Live demo: expensive call | escalation appears, click *Approve*, tx flows |
| 2:10–2:30 | Live demo: blocked call | red error, dashboard shows the deny |
| 2:30–2:50 | Tour: dashboard, on-chain registry | `solana account <pda>` |
| 2:50–3:00 | Sponsor logos + thanks | static slide |

### 11.2 README.md sections (in order)
1. One-paragraph what + why.
2. 5-second install (`pnpm install && pnpm dev`).
3. 60-second quickstart (write a YAML, deploy, swap signer, run a tx).
4. Architecture diagram (link to the Excalidraw file).
5. Sponsor track addressability (one bullet per track).
6. License (MIT).

### 11.3 Sponsor pitches (one paragraph each — drafts go in `docs/pitches/`)

| Track | Pitch focus |
|---|---|
| Zerion #1 (scoped agents) | "We *are* the policy layer Zerion's agent CLI was built to plug" |
| Zerion #2 (real txs) | "Every demo tx flows through `zerion-cli` end-to-end on devnet" |
| Dune SIM | "Wallet-balance widget + agent activity feed via `/svm/balances`" |
| RPC Fast / Helius | "Helius webhooks for real-time on-chain policy events; live in dashboard" |
| 100xDevs | "Solo build, full SDK + dashboard, 17 days" |
| Adevar/Eitherway | "Pure infra play — agent transaction firewall as a primitive" |
| Superteam India | "Indian builder, regional standout" |

### 11.4 Submission checklist (binary)
- [ ] Repo public on GitHub
- [ ] Devnet program ID + IDL committed
- [ ] Demo video uploaded (YouTube or Loom)
- [ ] README quickstart works on a clean clone
- [ ] Submission form filled, screenshot saved
- [ ] Sponsor channel posts done (one per track)

---

## 12. Glossary (so we mean the same things)

- **Agent** — the autonomous process that holds a Solana keypair and signs txs.
- **Owner** — the human (or hardware wallet) authorized to update/revoke an agent's policy.
- **Policy root** — `sha256(canonicalJson(policy))`. 32 bytes.
- **PolicyContext (`ctx`)** — what Zerion's policy dispatcher passes to `check`. Probed shape lives in `docs/policy-context-shape.md`.
- **TxSummary** — Sentinel's normalized, chain-agnostic transaction descriptor.
- **Verdict** — `Allow | Deny | Escalate`.
- **Escalation** — a verdict that requires human approval before signing.
- **Drift** — local YAML root != on-chain root. Always fatal for the current tx.

---

## 13. "When stuck" decision tree

| Symptom | First check | Second check | Last resort |
|---|---|---|---|
| `anchor build` fails | `anchor --version` matches `Anchor.toml`'s `[toolchain]` | Cargo workspace resolver = "2" | Delete `target/`, `.anchor/`, retry |
| `anchor deploy` fails with "insufficient funds" | `solana balance` ≥ 2 SOL | airdrop | Web faucet |
| `program.account.policyRecord.fetch(pda)` returns "Account does not exist" | the agent pubkey passed to `findProgramAddressSync` matches the one used for register | the program ID is the deployed one (not localnet's) | Re-derive the PDA in a fresh REPL |
| Helius webhook never arrives | tunnel (ngrok) is up | webhook registered at the right URL | Check Helius dashboard logs |
| Pyth price suddenly `Infinity` | Hermes responded but >60s ago | Hermes is slow today — switch to a backup feed ID | Treat all USD values as escalate, document |
| Zerion `check(ctx)` not invoked | `~/.config/zerion/policies/sentinel.mjs` exists | `agent create-policy` references `--scripts` correctly | Re-run the P0.T4 probe |

---

## 14. Top 10 things that will silently break if you skip them

1. The `phase-0-done` git tag — without it, you can't bisect later.
2. `docs/policy-context-shape.md` — the entire Zerion bridge is dead reckoning without it.
3. The `phase-2-done` IDL commit — Helius decoding depends on the on-chain IDL matching what we expect.
4. `noUncheckedIndexedAccess: true` in tsconfig — turn it on now, fix all errors immediately. Adding it later is days of work.
5. `.strict()` on every zod object — prevents typo'd policy keys silently doing nothing.
6. The price oracle's 60-second staleness rule — without it, a stuck Hermes pin opens an unbounded window.
7. SQLite `prune()` on startup — without it, the DB grows forever and queries slow down.
8. Versioned-tx rejection — accepting them silently parses them wrong and lets txs through.
9. Webhook auth header — Helius will retry; without auth, anyone can spoof events.
10. `lint-staged` skipping (or any pre-commit) — keep CI fast and fail in CI, not locally; don't waste time on hooks.

---

## 15. Diff vs v2 — what changed

- **+** Per-file specs for every package (Sections 5–10).
- **+** Cross-cutting standards (Section 2): tsconfig, env vars, error envelope, logging.
- **+** Threat model + invariants (Section 3) — invariants are referenced from every later phase.
- **+** Probe protocol for Zerion `ctx`, Helius payload, Hermes response (P0.T4, P5 webhook, Phase 3 oracle).
- **+** Anchor 0.32 specifics: `#[derive(InitSpace)]`, `idl-build` feature, declarative IDL, TS client constructor change.
- **+** `better-sqlite3` + Node 24 native-rebuild gotcha.
- **+** Pyth Hermes API surface (function names + response shape) called out, with `docs/pyth-response.md` as the recorded source of truth.
- **+** SQL schema for spend log, escalations, policy events.
- **+** Helius webhook spec: registration call, auth header, payload-shape probe.
- **+** Dune SIM proxy route that hides the API key server-side.
- **+** Demo video frame-by-frame script.
- **+** "When stuck" decision tree + top-10 silent-break list.