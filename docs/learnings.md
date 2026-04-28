# Sentinel — Build Learnings

Five hardest bugs across the 8-phase build, what they cost us, and what we
took away.

## 1. SBF cargo 1.84 vs `edition2024`

Anchor 0.32 + Solana CLI Agave 3.0 ship an SBF toolchain whose bundled cargo
(1.84) cannot parse `edition2024 = required` from newer transitive crates.
First `anchor build` failed with a parser error several layers deep in
`proc-macro-crate` 3.5. Took two hours to land on the right pin chain
(`proc-macro-crate=3.3.0`, `toml_datetime=0.6.11`, `toml_edit=0.22.27`,
`indexmap=2.10.0`, `unicode-segmentation=1.12.0`). Re-pinning blindly is
tempting; it works only because we explicitly target SBF cargo 1.84 today.
The lesson: **document which toolchain combination a Cargo.lock pin chain is
written against**, otherwise the next person to bump Anchor inherits a silent
landmine. Captured in `RESOURCES.md` (D7).

## 2. Base58 placeholders that aren't

Test fixtures used pubkeys like `Treasury11…` and `Bl0cked11…` for
human-readability. Base58 excludes `0`, `O`, `I`, `l`. The Solana parser
rejected them late, in the test runner, with a misleading "invalid keypair"
error rather than "invalid character". Generating real keypairs and listing
them in `RESOURCES.md` ended this class of bug. **Type the alphabet you're
in, especially when faking data.**

## 3. The stub payment builder's destination paradox

Token allowlists are written against wallet pubkeys. SPL `TransferChecked`
takes ATA pubkeys. The off-chain stub builder couldn't satisfy both — if the
instruction used a real ATA, the signer's tx-parser would see the ATA in the
destination key and reject the allowlist. We landed on putting the wallet
pubkey directly into the instruction as a knowingly-invalid stub, with a
comment that the live x402 spike (Front A3) replaces both ends at once: real
ATA in the instruction *and* ATA→owner inversion in the parser via RPC. The
takeaway: **two-sided bugs need two-sided fixes; don't half-fix them or you
break tests for no benefit.**

## 4. exactOptionalPropertyTypes and the Hermes client

Hermes' typings expose `getLatestPriceUpdates(ids, opts?)` with `opts` as
optional. With `exactOptionalPropertyTypes: true` in our base tsconfig, you
cannot pass `opts: undefined` — only omit it. Several attempts to spread a
config object failed type checks. The eventual fix was a one-liner type
assertion at the construction site (`as unknown as HermesLike`) with a
shape we control. **`exactOptionalPropertyTypes` rewards explicit construction
sites and punishes generic spread-into-options patterns.** Worth the trade.

## 5. The webhook that always returns 200

The dashboard's `/api/webhook` route gracefully accepted requests when
`HELIUS_WEBHOOK_SECRET` was unset, on the assumption that local dev wanted
that flexibility. It also meant the production deployment, if you forgot to
set the env, silently accepted *anyone's* payload. A submission gate for
"hackathon demo" can be the same code as production. We added a module-load
check that throws unless `NODE_ENV !== "production"` AND
`SENTINEL_ALLOW_UNAUTH_WEBHOOK=1` is explicit. **Default to fail-loud at boot,
and require an explicit opt-out for dev mode.**

## What each phase taught

| Phase | One-line lesson |
|---|---|
| P0 (toolchain) | Pin cargo crates to the SBF toolchain, not "latest stable". |
| P1 (DSL + engine) | Pure functions and a strict zod schema make the rule precedence trivial to test. RFC 8785 canonicalization avoided every ordering bug we expected. |
| P2 (Anchor program) | `#[derive(InitSpace)]` and a `_reserved` byte field are cheap insurance against schema migrations. |
| P3 (signer-shim) | The on-chain root check is the single most security-relevant line of code. Cache it, but invalidate on `onLogs` not just TTL. |
| P4 (x402 interceptor) | Build the offline stub *and* the live SDK adapter behind the same `PaymentBuilder` interface from day one. Switching is a one-line change. |
| P5 (dashboard) | SSE > WebSocket for "push 5 events to the dashboard." Less code, no library, it just works. |
| P6 (docs) | Each sponsor track wants something different — write seven one-paragraph pitches, not one five-paragraph essay. |
| P7 (review/submit) | The submission gate is binary. Eight green checkboxes or it doesn't ship. |

(~600 words)
