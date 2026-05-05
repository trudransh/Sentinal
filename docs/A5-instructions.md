# A5 — Real Zerion `ctx` probe

> **TL;DR:** the CLI's policy dispatcher only loads scripts named in the
> active policy's `config.scripts` array. The previous "drop a file in
> `~/.config/zerion/policies/`" approach is dead on this CLI build. The
> only working hook point is to temporarily replace the bundled
> `deny-transfers.mjs` with our probe, fire one `zerion` command, restore.
>
> ```bash
> # default — patches global install, holds an flock for the patch window
> pnpm probe:zerion
>
> # safer — installs zerion-cli into a disposable prefix; global is untouched
> ZERION_ISOLATED=1 pnpm probe:zerion
> ```

---

## Acceptance criteria (strict)

A5 is **closed** only when **all** of the following hold:

1. `/tmp/sentinel-zerion-ctx.json` was created by a **real** `zerion` command
   (not the smoke test, which pipes synthetic JSON to the dispatcher).
2. The dump contains realistic Zerion-runtime fields (chain, wallet, tx
   payload), not the smoke fixture (`{"transaction":{"from":"smoke",...}}`).
3. The capture is reproducible — re-running the same command produces the
   same shape (different ids/timestamps, same field names).
4. Evidence preserved: `/tmp/sentinel-a5-evidence.txt` (command + stdout
   tail + dump head) and `/tmp/sentinel-zerion-attempts.log` (full log of
   every attempted command).

If only the smoke test produced a dump, A5 is **NOT closed** — smoke proves
the patch wiring works, not that any real CLI command flows through it.
Document smoke output as diagnostic evidence and continue investigating.

## How to run

### Default (global patch + flock)

```bash
pnpm probe:zerion
```

The script:

1. Acquires an `flock` on `$ZERION_POL_DIR/.sentinel-a5.lock`. Any
   concurrent `zerion` invocation on this machine that also tries to
   acquire the lock will block until the script finishes — eliminating the
   race where another terminal picks up the patched script.
2. Backs up `$(npm root -g)/zerion-cli/cli/policies/deny-transfers.mjs`
   to `/tmp/deny-transfers.mjs.bak.$$`.
3. Overwrites it with `scripts/probes/zerion.mjs`.
4. Tries 5 commands in priority order (first to produce a dump wins,
   remaining attempts are skipped):

   | # | Command | Why it's tried |
   |---|---|---|
   | 1 | `sign-message ... --chain ethereum` | Off-chain; no funds, no swap API; docs say "requires agent token" |
   | 2 | `sign-message ... --chain solana` | Same path, Solana flavor |
   | 3 | `send eth 0.0000001 --to 0x…dEaD --chain base` | RFC burn address, valid 0x |
   | 4 | `send usdc 0.001 --to 0x…dEaD --chain base` | USDC variant |
   | 5 | `swap eth usdc 0.0000001 --chain base` | Last-ditch EVM swap |

5. On success: writes `/tmp/sentinel-a5-evidence.txt` with the command,
   stdout/stderr tail, and dump head.
6. On no-success: runs a **smoke test** (synthetic ctx → `run-policies.mjs`)
   labelled "DIAGNOSTIC ONLY — A5 IS NOT CLOSED" with explicit messaging
   that smoke is not a substitute for real ctx.
7. **Always** restores `deny-transfers.mjs` from backup via
   `trap restore EXIT INT TERM`.

### Isolated (`ZERION_ISOLATED=1`)

```bash
ZERION_ISOLATED=1 pnpm probe:zerion
```

This installs zerion-cli into `/tmp/sentinel-zerion-isolated.<pid>/` via
`npm install --prefix`, patches **only** that copy, and runs `zerion` from
`$PREFIX/node_modules/.bin/zerion`. Your global install is never modified.
The trap also `rm -rf`s the prefix on exit.

Caveat: the isolated install reads auth/config from your usual
`~/.config/zerion/`, so it picks up your `apiKey`, `defaultWallet`, and
agent token. If for some reason the isolated CLI doesn't see your config,
fall back to the default mode.

## Pre-flight (verify once)

| Need | How to verify |
|---|---|
| `zerion` CLI on PATH | `zerion --version` |
| API key configured | `zerion config list` shows `apiKey: zk_...` |
| Wallet named `sentinelbot` (or override) | `zerion wallet list` |
| Active agent token | `zerion agent list-tokens` |
| `flock` available | `command -v flock` |

If your wallet name differs, override:

```bash
SENTINEL_PROBE_WALLET=mybotname pnpm probe:zerion
```

## Why the old approach failed

The active policy looks like:

```json
{
  "id": "policy-standard-b55a15a4",
  "config": { "scripts": ["deny-transfers.mjs"] },
  "executable": ".../zerion-cli/cli/policies/run-policies.mjs"
}
```

The dispatcher (`run-policies.mjs`) iterates `config.scripts`,
dynamic-imports each file, and calls `mod.check(ctx)` with a 4 s timeout.
Files dropped into `~/.config/zerion/policies/` are not in this list and
never get loaded. `agent create-policy` in this CLI build has no
`--script` / `--policy-file` / `--hook` flag, so we can't bind a custom
file to the active policy — the only injection point is the bundled
script the policy already references.

## Safety considerations

| Concern | Mitigation |
|---|---|
| Concurrent `zerion` in another terminal sees patched script | `flock` on policies dir; concurrent invocations block on the lock |
| Script crashes mid-patch (Ctrl-C, segfault) | `trap restore EXIT INT TERM` |
| `kill -9` bypasses trap | `bash scripts/probes/zerion-restore.sh` finds the latest backup |
| Patch file name differs across CLI versions | Auto-detected via `npm root -g`; overrideable via `ZERION_POL_DIR` |
| Don't trust global mutation at all | `ZERION_ISOLATED=1` runs in a disposable prefix |

## What you do with the dump

Paste `/tmp/sentinel-zerion-ctx.json` (or the contents of
`/tmp/sentinel-a5-evidence.txt`) back into Claude Code. I'll then:

1. Replace `docs/policy-context-shape.md`'s placeholder with the real schema.
2. Rewrite `packages/zerion-bridge/src/adapter.ts` against the actual fields.
3. Update the 4 `adapter.test.ts` fixtures with realistic input.
4. Mark A5 done in tasks + CHANGELOG.

## What you do if every real command bails

If smoke passes but no real attempt produced a dump:

```bash
# Capture exact help shapes for your CLI version, then paste:
zerion --help              | tee /tmp/zerion-help.txt
zerion send --help         | tee /tmp/zerion-send-help.txt
zerion sign-message --help | tee /tmp/zerion-sign-help.txt
zerion swap --help         | tee /tmp/zerion-swap-help.txt
zerion bridge --help       | tee /tmp/zerion-bridge-help.txt
```

Plus the contents of `/tmp/sentinel-zerion-attempts.log` (every command's
output). With those, I can determine the exact command shape this CLI
accepts. If no shape ever invokes the dispatcher, A5 is **blocked** by the
alpha CLI surface and we document with logs as evidence — that's a
defensible state, not a missing implementation.

## Why this matters

`packages/zerion-bridge/src/adapter.ts` currently dead-reckons the `ctx`
shape. If any field differs in reality (e.g. `chainId` vs `chain`, or
`payload` vs `data`), the bridge silently returns `null` for every Solana
tx and the policy is bypassed on the Zerion path. A5 closes that gap with
a captured ground-truth shape.
